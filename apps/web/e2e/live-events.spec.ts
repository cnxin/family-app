import { expect, test, type Page } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession, stamp } from './helpers';

// H2b：真实的 /events，不 mock。两个浏览器上下文是同一家庭的两个人；另一边一律不刷新。

/** 等这一页的 /events 连上（响应头到了就算）。要在 goto 之前挂上。 */
function eventsConnected(page: Page) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.status() === 200,
  );
}

async function shoppingDate(page: Page) {
  // 购物页默认日期按设备取（timezone-audit T3 未修）；用页面上的值，别自己算
  return page.getByLabel('选择日期').inputValue();
}

test('两个家人同开购物清单：一边加、一边勾，另一边不刷新 3 秒内跟着变', async ({ browser, page, request }) => {
  const admin = apiClient(request);
  const member = await freshMemberSession(request, '同步家人');
  const other = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  const otherPage = await other.newPage();
  await seedSession(otherPage, member);
  let itemId: string | null = null;
  try {
    const connected = eventsConnected(otherPage);
    await Promise.all([page.goto('/house/shopping'), otherPage.goto('/house/shopping')]);
    await connected;
    await expect(otherPage.getByRole('heading', { name: '购物清单' })).toBeVisible();

    const name = stamp('同步');
    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/shopping-items',
    );
    await page.getByLabel('物品名称').fill(name);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    itemId = ((await (await created).json()) as { data: { id: string } }).data.id;
    await expect(otherPage.getByRole('checkbox', { name: `勾选${name}` })).toBeVisible({ timeout: 3_000 });

    await page.getByRole('checkbox', { name: `勾选${name}` }).click();
    await expect(otherPage.getByRole('checkbox', { name: `取消勾选${name}` })).toBeVisible({ timeout: 3_000 });
  } finally {
    await other.close();
    if (itemId) await admin.delete(`/shopping-items/${itemId}`).catch(() => undefined);
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});

test('连不上超过 30 秒才提示实时更新已暂停；恢复后提示消失，期间的变化补齐', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '要等两个 30 秒，只在桌面项目跑一次');
  test.setTimeout(150_000);
  const admin = apiClient(request);
  const member = await freshMemberSession(request, '补齐家人');
  const memberApi = { headers: { Authorization: `Bearer ${member.accessToken}` } };

  // 一、连接正常时，过了 30 秒也不该冒提示（开发模式 effect 挂两次曾让它误报）
  const connected = eventsConnected(page);
  await page.goto('/house/shopping');
  await connected;
  await page.waitForTimeout(31_000);
  await expect(page.locator('[data-live-paused]')).toHaveCount(0);

  // 二、连不上：已建立的流 Playwright 掐不断，所以拦住 /api/events 再刷新，让它一直连不上
  await page.route('**/api/events', (route) => route.abort('internetdisconnected'));
  await page.reload();
  const date = await shoppingDate(page);
  const cutAt = Date.now();
  await expect(page.locator('[data-live-paused]')).toBeVisible({ timeout: 45_000 });
  expect(Date.now() - cutAt, '不到 30 秒不该提示').toBeGreaterThanOrEqual(29_000);
  await expect(page.locator('[data-live-paused]')).toContainText('实时更新已暂停');

  // 连不上的这段时间里，另一个家人加了一样
  const name = stamp('断线补齐');
  const created = await request.post(`${apiURL}/shopping-items`, {
    ...memberApi,
    data: { date, customName: name, totalQty: 1, unit: '份' },
  });
  expect(created.status()).toBe(201);
  const itemId = ((await created.json()) as { data: { id: string } }).data.id;
  try {
    await expect(page.getByRole('checkbox', { name: `勾选${name}` })).toHaveCount(0);
    await page.unroute('**/api/events');
    const reconnected = eventsConnected(page);
    // 页面回到前台：没连着就立刻重连，不等退避
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reconnected;
    await expect(page.locator('[data-live-paused]')).toBeHidden({ timeout: 5_000 });
    await expect(page.getByRole('checkbox', { name: `勾选${name}` })).toBeVisible({ timeout: 5_000 });
  } finally {
    await admin.delete(`/shopping-items/${itemId}`).catch(() => undefined);
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});

test('访客在公开邀请页点菜后，管理员今天页 3 秒内出现留意卡', async ({ browser, page, request }) => {
  const admin = apiClient(request);
  const guestName = stamp('点菜客人');
  const visitDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const guest = await admin.post<{ id: string }>('/guests', { name: guestName });
  const visit = await admin.post<{ id: string }>('/visits', {
    title: stamp('来吃饭'),
    startsAt: `${visitDate}T10:00:00.000Z`,
    endsAt: `${visitDate}T14:00:00.000Z`,
    guestIds: [guest.id],
  });
  const dish = await admin.post<{ id: string; name: string }>('/dishes', { name: stamp('客人要的菜'), category: '荤菜' });
  const menu = await admin.get<{ id: string }>(`/menus?date=${visitDate}&mealType=dinner`);
  await admin.post(`/menus/${menu.id}/items`, { items: [{ dishId: dish.id }] });
  const invitation = await admin.post<{ invitationToken: string }>(`/visits/${visit.id}/invitations`, {
    guestId: guest.id,
    allowsMealRequests: true,
  });

  const connected = eventsConnected(page);
  await page.goto('/');
  await connected;
  const attention = page.locator('[data-today-attention]');

  const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guestContext.newPage();
  try {
    await guestPage.goto(`/guest/${invitation.invitationToken}`);
    const claimed = guestPage.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/meal-options\/[^/]+\/request$/.test(new URL(response.url()).pathname),
    );
    // 管理员这边不刷新：3 秒内由 guests 事件触发重取留意，且结果里有待处理的访客点菜
    const refetched = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/today/attention' && response.status() === 200,
      { timeout: 3_000 },
    );
    await guestPage.getByRole('article', { name: dish.name }).getByRole('button', { name: '我要这道' }).click();
    expect((await claimed).status()).toBe(201);
    const body = (await (await refetched).json()) as { data: { items: { domain: string; kinds: string[] }[] } };
    expect(body.data.items.find((item) => item.domain === 'guests')?.kinds).toContain('meal-request');
    await expect(attention.locator('[data-attention-card]').filter({ hasText: '访客' }).first()).toBeVisible({
      timeout: 3_000,
    });
  } finally {
    await guestContext.close();
    await admin.patch(`/visits/${visit.id}`, { status: 'cancelled' }).catch(() => undefined);
  }
});
