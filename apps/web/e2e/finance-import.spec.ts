import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, expectNoHorizontalOverflow, stamp, watchPageErrors } from './helpers';

/**
 * K1 账单导入（docs/finance-plan.md §3-K1）：流水 → 导入账单 → 传微信样例 → 预览里改一行分类 → 确认 →
 * 流水切到账单那个月、能看到导入的那笔，导入记录里有这一批。手机上预览是卡片列表，电脑上是表格。
 * 两个视口共用一个库、单号按家庭去重：每次把样例里的交易单号换成这次独有的。
 */

const FIXTURE = resolve(process.cwd(), '../api/test/fixtures/finance/wechat-sample.csv');

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

test('导入微信账单：预览改分类后确认，流水和导入记录里都能看到', async ({ page, request }, testInfo) => {
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const accountName = stamp('导入零钱');
  const mobile = testInfo.project.name.startsWith('mobile');
  const run = Date.now().toString(36);
  const statement = readFileSync(FIXTURE, 'utf8').replace(/42000(\d{23})/g, (_, rest: string) => `E2E${run}${rest}`);
  await admin.post('/finance/accounts', { name: accountName, type: 'wechat', openingBalance: 0 });

  try {
    await page.goto('/house/finance?view=ledger');
    await page.getByRole('button', { name: '导入账单' }).click();
    const dialog = page.getByRole('dialog', { name: '导入账单' });
    await dialog.getByRole('button', { name: accountName }).click();
    await dialog.getByRole('tab', { name: '微信' }).click();
    await expect(dialog).toContainText('下载账单');
    await dialog.getByLabel('账单文件').setInputFiles({
      name: '微信支付账单(20260901-20260930).csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(statement),
    });
    const uploaded = waitFor(page, 'POST', /\/finance\/imports$/);
    await dialog.getByRole('button', { name: '上传并预览' }).click();
    expect((await uploaded).status(), await (await uploaded).text()).toBe(201);

    const preview = page.getByRole('dialog', { name: '导入账单 · 预览' });
    await expect(preview).toContainText('共 52 行，建议导入 45，已导入 1，疑似重复 0');
    const medicine = mobile
      ? preview.getByRole('listitem', { name: '第 2 行 康安大药房-望京店' })
      : preview.getByRole('row', { name: '第 2 行 康安大药房-望京店' });
    // 手机走卡片列表、电脑走表格
    await expect(preview.getByRole('table')).toHaveCount(mobile ? 0 : 1);
    await expect(medicine).toContainText('-¥96.35');
    await expect(medicine.getByRole('checkbox', { name: '导入第 2 行 康安大药房-望京店' })).toHaveAttribute('aria-checked', 'true');
    // 同一单号第二次出现的那行标「已导入」、勾不上
    const repeated = mobile
      ? preview.getByRole('listitem', { name: '第 22 行 公交乘车码' })
      : preview.getByRole('row', { name: '第 22 行 公交乘车码' });
    await expect(repeated).toContainText('已导入');
    await expect(repeated.getByRole('checkbox')).toBeDisabled();
    await medicine.getByLabel('第 2 行 康安大药房-望京店的分类').selectOption({ label: '育儿' });
    if (mobile) await expectNoHorizontalOverflow(page);

    const committed = waitFor(page, 'POST', /\/finance\/imports\/[^/]+\/commit$/);
    await preview.getByRole('button', { name: '确认导入 45 笔' }).click();
    expect((await committed).status(), await (await committed).text()).toBe(201);
    await expect(page.getByText('导入 45 笔，跳过 7 笔')).toBeVisible();
    await expect(preview).toBeHidden();

    // 流水切到账单那个月：名字是交易对方、备注是商品；改过分类的那笔按「育儿」记，标着谁导入的
    await expect(page.getByText('2026 年 9 月')).toBeVisible();
    const entry = page
      .getByRole('article', { name: '康安大药房-望京店', exact: true })
      .filter({ hasText: accountName })
      .filter({ hasText: '-¥96.35' });
    await expect(entry).toContainText('育儿');
    await expect(entry).toContainText('导入');
    await expect(entry).toContainText('药品');

    await page.getByRole('button', { name: /导入记录/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: `微信 → ${accountName}` })).toContainText(
      '导入 45 · 跳过 6 · 重复 1',
    );
    expect(errors).toEqual([]);
  } finally {
    // 账本不可删，账户停用就行
    const accounts = await admin.get<{ id: string; name: string; version: number }[]>('/finance/accounts?includeInactive=true');
    const mine = accounts.find((one) => one.name === accountName);
    if (mine) await admin.patch(`/finance/accounts/${mine.id}`, { isActive: false, expectedVersion: mine.version });
  }
});
