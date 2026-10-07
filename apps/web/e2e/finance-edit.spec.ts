import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, apiURL, authFiles, expectNoHorizontalOverflow, stamp, watchPageErrors } from './helpers';

/**
 * K5 流水编辑（docs/finance-plan.md §3-K5）：导入样例 → 点一笔改分类 → 「同时改另外 N 笔」→ 同商户都变了；
 * 批量选 3 笔改账户；删除一笔后不见、开「显示已删除」能看到；搜「停车」只剩停车场那几笔；
 * 成员能改自己记的，别人记的不出编辑入口。两个视口共用一个库：商户名、单号都带这次独有的标记。
 */

const FIXTURE = resolve(process.cwd(), '../api/test/fixtures/finance/wechat-sample.csv');

function waitFor(page: Page, method: string, pathPattern: RegExp) {
  return page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname),
  );
}

/** 从这个月往回翻到 2026 年 9 月（样例账单的月份）。 */
async function goToSeptember(page: Page) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const back = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - (2026 * 12 + 9);
  for (let step = 0; step < back; step += 1) await page.getByRole('button', { name: '上个月' }).click();
  await expect(page.getByText('2026 年 9 月')).toBeVisible();
}

async function search(page: Page, text: string) {
  const listed = waitFor(page, 'GET', /\/finance\/transactions$/);
  await page.getByLabel('搜流水').fill(text);
  await listed;
}

test('流水编辑：改分类连带同商户、批量改账户、删除与显示已删除、搜索', async ({ page, request }, testInfo) => {
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const run = Date.now().toString(36);
  const mobile = testInfo.project.name.startsWith('mobile');
  const wallet = stamp('改账零钱');
  const bank = stamp('改账银行卡');
  const meituan = `美团${run}-望京店`;
  const shop = `便利店${run}`;
  const power = `国家电网${run}`;
  const header = readFileSync(FIXTURE, 'utf8');
  const parking = [1, 2, 3].map(
    (day) => `2026-09-0${day} 08:00:00,商户消费,柯桥东升路停车场-停车缴费-浙AGS6398,"停车缴费",支出,¥${day}.00,零钱,支付成功,PK${run}${day}\t,,"/"`,
  );
  const statement = [
    header.replace(/42000(\d{23})/g, (_, rest: string) => `E5${run}${rest}`).replaceAll('美团-望京店', meituan)
      .replaceAll('楼下便利店', shop).replaceAll('国家电网北京市电力公司', power).trimEnd(),
    ...parking,
  ].join('\n');
  const walletAccount = await admin.post<{ id: string }>('/finance/accounts', { name: wallet, type: 'wechat', openingBalance: 0 });
  await admin.post('/finance/accounts', { name: bank, type: 'bank', openingBalance: 0 });
  const uploaded = await request.post(`${apiURL}/finance/imports`, {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
    multipart: { source: 'wechat', accountId: walletAccount.id, file: { name: 'k5.csv', mimeType: 'text/csv', buffer: Buffer.from(statement) } },
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const preview = ((await uploaded.json()) as { data: { id: string } }).data;
  await admin.post(`/finance/imports/${preview.id}/commit`, { rows: [] });

  try {
    await page.goto('/house/finance?view=ledger');
    await goToSeptember(page);

    // 1. 点一笔改分类 → 「同时改另外 2 笔」→ 同商户 3 笔都是烟酒零食
    await search(page, meituan);
    const meituanRows = page.getByRole('article', { name: meituan, exact: true });
    await expect(meituanRows).toHaveCount(3);
    await meituanRows.first().click();
    const editor = page.getByRole('dialog', { name: '改一笔' });
    await editor.getByRole('button', { name: '烟酒零食', exact: true }).click();
    if (mobile) await expectNoHorizontalOverflow(page);
    const patched = waitFor(page, 'PATCH', /\/finance\/transactions\/[^/]+$/);
    await editor.getByRole('button', { name: '保存' }).click();
    expect((await patched).status(), await (await patched).text()).toBe(200);
    await expect(editor).toBeHidden();
    const followUp = waitFor(page, 'POST', /\/finance\/transactions\/batch$/);
    await page.getByRole('button', { name: '同时改另外 2 笔' }).click();
    expect((await followUp).status()).toBe(201);
    await expect(page.getByText('已改 2 笔，跳过 0 笔')).toBeVisible();
    for (let index = 0; index < 3; index += 1) await expect(meituanRows.nth(index)).toContainText('烟酒零食');

    // 2. 批量选 3 笔改账户
    await search(page, shop);
    const shopRows = page.getByRole('article', { name: shop, exact: true });
    await expect(shopRows).toHaveCount(5);
    await page.getByRole('button', { name: '选择' }).click();
    for (let index = 0; index < 3; index += 1) {
      await shopRows.nth(index).getByRole('checkbox', { name: `选中${shop}` }).click();
    }
    const toolbar = page.getByRole('toolbar', { name: '批量操作' });
    await expect(toolbar).toContainText('已选 3');
    await toolbar.getByRole('button', { name: '改账户' }).click();
    const moveDialog = page.getByRole('dialog', { name: '把 3 笔挪到哪个账户？' });
    await moveDialog.getByRole('button', { name: bank }).click();
    const moved = waitFor(page, 'POST', /\/finance\/transactions\/batch$/);
    await moveDialog.getByRole('button', { name: `挪到「${bank}」` }).click();
    expect((await moved).status()).toBe(201);
    await expect(page.getByText('已改 3 笔，跳过 0 笔')).toBeVisible();
    await expect(toolbar).toBeHidden();
    await expect(shopRows.filter({ hasText: bank })).toHaveCount(3);
    await expect(shopRows.filter({ hasText: wallet })).toHaveCount(2);

    // 3. 删除一笔：列表里不见了；打开「显示已删除」能看到、标着已删除
    await search(page, power);
    const powerRows = page.getByRole('article', { name: power, exact: true });
    await expect(powerRows).toHaveCount(3);
    await powerRows.first().click();
    await editor.getByRole('button', { name: '删除' }).click();
    const removed = waitFor(page, 'DELETE', /\/finance\/transactions\/[^/]+$/);
    await page.getByRole('dialog', { name: '删除这笔？' }).getByRole('button', { name: '确认删除' }).click();
    expect((await removed).status()).toBe(200);
    await expect(powerRows).toHaveCount(2);
    await page.getByRole('button', { name: /^筛选/ }).click();
    const filterDialog = page.getByRole('dialog', { name: '筛选流水' });
    await filterDialog.getByRole('switch', { name: '显示已删除' }).click();
    await filterDialog.getByRole('button', { name: '完成' }).click();
    await expect(page.getByRole('button', { name: '去掉筛选 显示已删除' })).toBeVisible();
    await expect(powerRows).toHaveCount(3);
    await expect(powerRows.filter({ hasText: '已删除' })).toHaveCount(1);
    await page.getByRole('button', { name: '去掉筛选 显示已删除' }).click();
    await expect(powerRows).toHaveCount(2);

    // 4. 搜「停车」：只剩停车场那几笔
    await search(page, '停车');
    const all = page.getByRole('article');
    await expect(all.filter({ hasText: '柯桥东升路停车场' }).first()).toBeVisible();
    const titles = await all.allInnerTexts();
    expect(titles.length).toBeGreaterThanOrEqual(3);
    expect(titles.every((text) => text.includes('停车'))).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    const accounts = await admin.get<{ id: string; name: string; version: number }[]>('/finance/accounts?includeInactive=true');
    for (const one of accounts.filter((account) => account.name === wallet || account.name === bank)) {
      await admin.patch(`/finance/accounts/${one.id}`, { isActive: false, expectedVersion: one.version });
    }
  }
});

test('流水编辑：成员能改自己记的，别人记的不出编辑入口', async ({ page, request }) => {
  const admin = apiClient(request);
  const member = apiClient(request, '妈妈');
  const accountName = stamp('成员改账');
  const mine = stamp('妈妈的午饭');
  const others = stamp('爸爸的午饭');
  const account = await admin.post<{ id: string }>('/finance/accounts', { name: accountName, type: 'cash', openingBalance: 100 });
  const categories = await admin.get<{ id: string; systemKey: string | null }[]>('/finance/categories');
  const food = categories.find((one) => one.systemKey === 'expense_food')!.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const record = (client: typeof admin, title: string) =>
    client.post('/finance/transactions', {
      type: 'expense', amount: 20, accountId: account.id, categoryId: food, title, occurredOn: today, idempotencyKey: `${title}-key`,
    });
  await record(member, mine);
  await record(admin, others);

  try {
    const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'] as { accessToken: string };
    await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
    await page.goto('/house/finance?view=ledger');
    const own = page.getByRole('article', { name: mine, exact: true });
    const notOwn = page.getByRole('article', { name: others, exact: true });
    await expect(own).toBeVisible();
    await expect(notOwn).toBeVisible();
    await expect(notOwn.getByRole('button', { name: `编辑${others}` })).toHaveCount(0);
    await notOwn.click();
    await expect(page.getByRole('dialog', { name: '改一笔' })).toHaveCount(0);

    await own.click();
    const editor = page.getByRole('dialog', { name: '改一笔' });
    await editor.getByLabel('名称').fill(`${mine}-改`);
    const patched = waitFor(page, 'PATCH', /\/finance\/transactions\/[^/]+$/);
    await editor.getByRole('button', { name: '保存' }).click();
    expect((await patched).status(), await (await patched).text()).toBe(200);
    await expect(page.getByRole('article', { name: `${mine}-改`, exact: true })).toBeVisible();
  } finally {
    const accounts = await admin.get<{ id: string; name: string; version: number }[]>('/finance/accounts?includeInactive=true');
    const one = accounts.find((item) => item.name === accountName);
    if (one) await admin.patch(`/finance/accounts/${one.id}`, { isActive: false, expectedVersion: one.version });
  }
});
