import { expect, test, type Page } from '@playwright/test';
import { apiClient, stamp } from './helpers';

/**
 * K4 信用卡账户（docs/finance-plan.md §3-K4）：管理员建一张信用卡（额度 / 账单日 / 还款日），刷一笔后卡片写「欠 ¥…」
 * 而不是「余额 -¥…」，从银行卡转账还款后显示已还清。
 */

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

test('信用卡：建卡、刷一笔后显示欠款、转账还款后已还清', async ({ page, request }) => {
  const admin = apiClient(request);
  const cardName = stamp('信用卡');
  const bankName = stamp('还款卡');
  const title = stamp('网购');
  await admin.post('/finance/accounts', { name: bankName, type: 'bank', openingBalance: 1000 });

  try {
    await page.goto('/house/finance');
    await page.getByRole('tab', { name: '账户' }).click();
    await page.getByRole('button', { name: '+ 新增账户' }).click();
    const accountForm = page.getByRole('dialog', { name: '新增账户' });
    await accountForm.getByLabel('账户名称').fill(cardName);
    await accountForm.getByRole('button', { name: '信用卡', exact: true }).click();
    await accountForm.getByLabel('信用额度').fill('20000');
    await accountForm.getByLabel('账单日').fill('5');
    await accountForm.getByLabel('还款日').fill('23');
    await accountForm.getByLabel('当前欠款').fill('0');
    const created = waitFor(page, 'POST', /\/finance\/accounts$/);
    await accountForm.getByRole('button', { name: '保存账户' }).click();
    expect((await created).status(), await (await created).text()).toBe(201);
    await expect(accountForm).toBeHidden();
    const cardRow = page.getByLabel(cardName, { exact: true });
    await expect(cardRow).toContainText('额度 ¥20,000.00 · 每月 5 日出账 · 23 日还款');
    await expect(cardRow).toContainText('已还清');

    // 刷一笔：卡片写「欠」，不写「余额 -」
    await page.getByRole('button', { name: '+ 记一笔' }).click();
    const spend = page.getByRole('dialog', { name: '记一笔' });
    await spend.getByLabel('金额').fill('88.80');
    await spend.getByRole('button', { name: new RegExp(cardName) }).click();
    await spend.getByLabel('账目名称').fill(title);
    const spent = waitFor(page, 'POST', /\/finance\/transactions$/);
    await spend.getByRole('button', { name: '确认记账' }).click();
    expect((await spent).status(), await (await spent).text()).toBe(201);
    await expect(spend).toBeHidden();
    await expect(cardRow).toContainText('欠 ¥88.80');
    await expect(cardRow).not.toContainText('-¥88.80');

    // 还款 = 从银行卡转账进信用卡
    await page.getByRole('button', { name: '+ 记一笔' }).click();
    const repay = page.getByRole('dialog', { name: '记一笔' });
    await repay.getByRole('tab', { name: '转账' }).click();
    await repay.getByLabel('金额').fill('88.80');
    await repay.getByRole('button', { name: new RegExp(bankName) }).first().click();
    await repay.getByRole('button', { name: cardName, exact: true }).click();
    await repay.getByLabel('账目名称').fill(stamp('还信用卡'));
    const repaid = waitFor(page, 'POST', /\/finance\/transactions$/);
    await repay.getByRole('button', { name: '确认记账' }).click();
    expect((await repaid).status(), await (await repaid).text()).toBe(201);
    await expect(repay).toBeHidden();
    await expect(cardRow).toContainText('已还清');
    await expect(page.getByLabel(bankName, { exact: true })).toContainText('¥911.20');
  } finally {
    // 账本不可删，账户停用就行
    const accounts = await admin.get<{ id: string; name: string; version: number; isActive: boolean }[]>(
      '/finance/accounts?includeInactive=true',
    );
    for (const account of accounts.filter((one) => [cardName, bankName].includes(one.name) && one.isActive)) {
      await admin.patch(`/finance/accounts/${account.id}`, { isActive: false, expectedVersion: account.version });
    }
  }
});
