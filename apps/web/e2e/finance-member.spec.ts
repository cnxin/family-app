import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiClient, apiURL, authFiles, stamp } from './helpers';

/**
 * 财务权限口径（architecture §8.6 第 3 条）：普通成员能看流水、记一笔；
 * 账户、分类、预算、冲销只有管理员能做，入口对成员不渲染，直接调接口 403。管理员路径见 write-paths。
 */

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

test('普通成员：财务分段可见，记一笔支出后在流水里看到，没有预算 / 账户入口', async ({ page, request }) => {
  const admin = apiClient(request);
  const accountName = stamp('成员记账');
  const title = stamp('买菜');
  const account = await admin.post<{ id: string; version: number }>('/finance/accounts', {
    name: accountName,
    type: 'cash',
    openingBalance: 500,
  });
  const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'] as { accessToken: string };

  try {
    await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
    await page.goto('/home');
    const tile = page.locator('main').getByRole('link', { name: '财务', exact: true });
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page).toHaveURL(/\/house\/finance$/);

    await expect(page.getByRole('tab', { name: '流水' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '预算' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '账户' })).toHaveCount(0);

    await page.getByRole('button', { name: '+ 记一笔' }).click();
    const form = page.getByRole('dialog', { name: '记一笔' });
    await form.getByLabel('金额').fill('36.50');
    await form.getByRole('button', { name: new RegExp(accountName) }).click();
    await form.getByLabel('账目名称').fill(title);
    const recorded = waitFor(page, 'POST', /\/finance\/transactions$/);
    await form.getByRole('button', { name: '确认记账' }).click();
    expect((await recorded).status(), await (await recorded).text()).toBe(201);
    await expect(form).toBeHidden();

    await page.getByRole('tab', { name: '流水' }).click();
    const entry = page.getByRole('article', { name: title, exact: true });
    await expect(entry).toContainText('-¥36.50');
    await expect(entry.getByRole('button', { name: `撤销${title}` })).toHaveCount(0);

    // 预算、账户的写接口直接调也不行
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const categories = await admin.get<{ id: string; kind: string }[]>('/finance/categories');
    const expense = categories.find((one) => one.kind === 'expense')!;
    const budget = await request.put(`${apiURL}/finance/budgets`, {
      headers,
      data: { categoryId: expense.id, month: '2026-10', amount: 1 },
    });
    expect(budget.status()).toBe(403);
    const deactivate = await request.patch(`${apiURL}/finance/accounts/${account.id}`, {
      headers,
      data: { isActive: false, expectedVersion: account.version },
    });
    expect(deactivate.status()).toBe(403);
  } finally {
    // 账本不可删，停用就行
    const accounts = await admin.get<{ id: string; name: string; version: number }[]>('/finance/accounts?includeInactive=true');
    const mine = accounts.find((one) => one.name === accountName);
    if (mine) await admin.patch(`/finance/accounts/${mine.id}`, { isActive: false, expectedVersion: mine.version });
  }
});
