import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiClient, authFiles, stamp } from './helpers';

/**
 * K3 周期账单（docs/finance-plan.md §3-K3）：管理员在「固定支出」建一条月付，到期前 3 天起成员能点「已付」，
 * 落一笔流水并推到下一期。增删改只有管理员，成员那边不出编辑入口。
 */

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

test('固定支出：管理员建一条月付，成员点「已付」后推到下一期并记进流水', async ({ page, request }) => {
  const admin = apiClient(request);
  const accountName = stamp('房租卡');
  const title = stamp('房租');
  await admin.post('/finance/accounts', { name: accountName, type: 'bank', openingBalance: 5000 });

  try {
    // 管理员（默认登录态）：固定支出 → 新增，默认每月、从今天起、到期提醒（不自动记账）
    await page.goto('/house/finance');
    await page.getByRole('tab', { name: '固定支出' }).click();
    await page.getByRole('button', { name: '+ 新增' }).click();
    const form = page.getByRole('dialog', { name: '新增周期账单' });
    await form.getByLabel('周期账单名称').fill(title);
    await form.getByLabel('每期金额').fill('1500');
    await form.getByRole('button', { name: accountName }).click();
    await form.getByRole('button', { name: '物业房租', exact: true }).click();
    await expect(form.getByRole('button', { name: '每月', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByRole('switch', { name: '到期自动记账' })).toHaveAttribute('aria-checked', 'false');
    const created = waitFor(page, 'POST', /\/finance\/recurring$/);
    await form.getByRole('button', { name: '保存' }).click();
    expect((await created).status(), await (await created).text()).toBe(201);
    await expect(form).toBeHidden();
    const row = page.getByRole('article', { name: title, exact: true });
    await expect(row).toContainText('每月 ¥1,500.00');
    await expect(row).toContainText('今天');
    await expect(row.getByRole('switch', { name: `自动记账${title}` })).toHaveAttribute('aria-checked', 'false');

    // 成员：同一页只读（没有编辑 / 删除 / 开关），到期的可以点「已付」
    const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'] as { accessToken: string };
    await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
    await page.goto('/house/finance?view=recurring');
    const memberRow = page.getByRole('article', { name: title, exact: true });
    await expect(memberRow).toContainText('到期提醒');
    await expect(memberRow.getByRole('button', { name: `编辑${title}` })).toHaveCount(0);
    await expect(memberRow.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ 新增' })).toHaveCount(0);
    const paid = waitFor(page, 'POST', /\/finance\/recurring\/[^/]+\/pay$/);
    await memberRow.getByRole('button', { name: `已付${title}` }).click();
    expect((await paid).status(), await (await paid).text()).toBe(201);
    // 推到下一期（一个月后），不再能点「已付」
    await expect(memberRow.getByRole('button', { name: `已付${title}` })).toHaveCount(0);
    await expect(memberRow).not.toContainText('今天');

    await page.getByRole('tab', { name: '流水' }).click();
    await expect(page.getByRole('article', { name: title, exact: true })).toContainText('-¥1,500.00');
  } finally {
    const rules = await admin.get<{ id: string; title: string; version: number }[]>('/finance/recurring');
    const rule = rules.find((one) => one.title === title);
    if (rule) await admin.delete(`/finance/recurring/${rule.id}?expectedVersion=${rule.version}`);
    // 账本不可删，账户停用就行
    const accounts = await admin.get<{ id: string; name: string; version: number }[]>('/finance/accounts?includeInactive=true');
    const mine = accounts.find((one) => one.name === accountName);
    if (mine) await admin.patch(`/finance/accounts/${mine.id}`, { isActive: false, expectedVersion: mine.version });
  }
});
