import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession } from './helpers';

// H3 E2：真 API + 假 Home Assistant + 真 /events（不 mock）。两个浏览器上下文是同一家庭的管理员和普通成员，
// 一边按、或者有人直接在 HA 里动了设备，另一边不刷新 3 秒内跟着变。

interface FakeHomeAssistant {
  url: string;
  setState(entityId: string, state: string, attributes?: Record<string, unknown>): unknown;
  serviceCalls: { domain: string; service: string; data: { entity_id?: string } }[];
  stop(): Promise<void>;
}

// 运行时再加载、类型在这里声明：前端镜像只带 apps/web，构建时的 tsc 看不到 apps/api/scripts（教训 33）
const FAKE_HA_MODULE = new URL('../../api/scripts/fake-ha.mjs', import.meta.url).href;
async function startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant> {
  const module = (await import(FAKE_HA_MODULE)) as {
    startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant>;
  };
  return module.startFakeHomeAssistant(options);
}

const TOKEN = 'e2e-home-assistant-long-lived-token-0002';

function eventsConnected(page: Page) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.status() === 200,
  );
}

async function cleanSmartHome(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  for (const device of await admin.get<{ entityId: string }[]>('/smart-home/devices')) {
    await admin.delete(`/smart-home/devices/${device.entityId}`);
  }
  await request.delete(`${apiURL}/smart-home/connector-settings`, { headers });
}

let ha: FakeHomeAssistant;

test.beforeEach(async ({ request }) => {
  ha = await startFakeHomeAssistant({ token: TOKEN });
  await cleanSmartHome(request);
  const admin = apiClient(request);
  await admin.put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  await admin.put('/smart-home/devices/vacuum.roborock_s8', {
    displayName: '扫地机',
    area: '客厅',
    controllable: true,
    minRole: 'member',
  });
  await admin.put('/smart-home/devices/cover.living_room_curtain', { displayName: '客厅窗帘', area: '客厅', controllable: true });
  await admin.put('/smart-home/devices/scene.movie_night', { displayName: '电影之夜', controllable: true, minRole: 'member' });
});

test.afterEach(async ({ request }) => {
  await cleanSmartHome(request);
  await ha.stop();
});

test('管理员和家人同开智能家居页：一边按、或有人在 HA 里动了，另一边不刷新 3 秒内跟着变；按角色给按钮', async ({
  browser,
  page,
  request,
}) => {
  const admin = apiClient(request);
  const member = await freshMemberSession(request, '控制家人');
  const other = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  const memberPage = await other.newPage();
  await seedSession(memberPage, member);
  try {
    const connected = [eventsConnected(page), eventsConnected(memberPage)];
    await Promise.all([page.goto('/house/smart-home'), memberPage.goto('/house/smart-home')]);
    await Promise.all(connected);

    const vacuumOf = (target: Page) => target.locator('[data-smart-home-device="vacuum.roborock_s8"]');
    const curtainOf = (target: Page) => target.locator('[data-smart-home-device="cover.living_room_curtain"]');
    await expect(vacuumOf(memberPage)).toContainText('在充电座上');

    // 按角色给按钮：扫地机全家能控；窗帘只有管理员
    await expect(memberPage.getByRole('button', { name: '扫地机：开始清扫' })).toBeVisible();
    await expect(curtainOf(memberPage).getByRole('group')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '客厅窗帘：关上' })).toBeVisible();

    // 家人按「开始清扫」：HA 真的收到 vacuum.start；管理员那边不刷新 3 秒内变成正在清扫
    await memberPage.getByRole('button', { name: '扫地机：开始清扫' }).click();
    await expect(vacuumOf(memberPage)).toContainText('正在清扫', { timeout: 3_000 });
    await expect(vacuumOf(page)).toContainText('正在清扫', { timeout: 3_000 });
    expect(ha.serviceCalls.filter((call) => call.service === 'start')).toHaveLength(1);
    // 状态变了，按钮也跟着变
    await expect(memberPage.getByRole('button', { name: '扫地机：回充' })).toBeVisible();

    // 管理员关窗帘：家人那边 3 秒内看到关着
    await page.getByRole('button', { name: '客厅窗帘：关上' }).click();
    await expect(curtainOf(memberPage)).toContainText('关着', { timeout: 3_000 });

    // 有人直接在 HA / 米家 App 里开了窗帘：两边都没按，3 秒内都变
    ha.setState('cover.living_room_curtain', 'open', { current_position: 60 });
    await expect(curtainOf(page)).toContainText('开了 60%', { timeout: 3_000 });
    await expect(curtainOf(memberPage)).toContainText('开了 60%', { timeout: 3_000 });

    // 场景在右栏，家人能执行
    await memberPage.getByRole('button', { name: '电影之夜：执行' }).click();
    await expect.poll(() => ha.serviceCalls.filter((call) => call.data.entity_id === 'scene.movie_night').length).toBe(1);

    // HA 那边出错：按钮恢复，提示说清原因
    await admin.put('/smart-home/devices/vacuum.roborock_s8', { displayName: '扫地机', area: '客厅', controllable: false });
    await expect(vacuumOf(memberPage).getByRole('group')).toHaveCount(0, { timeout: 3_000 });
  } finally {
    await other.close();
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});

test('管理员在设置页开放控制、改谁能控；最近的操作记下谁按了什么', async ({ page }) => {
  await page.goto('/house/smart-home/settings');
  const row = page.locator('[data-smart-home-whitelisted="cover.living_room_curtain"]');
  await expect(row.getByRole('checkbox', { name: '允许在小管家里控制客厅窗帘' })).toBeChecked();
  await row.getByLabel('客厅窗帘 谁能控').selectOption('member');
  await row.getByRole('button', { name: '保存' }).click();
  await expect(row.getByRole('button', { name: '保存' })).toHaveCount(0);

  // 传感器这类没有动作，不给开放控制的开关
  await page.getByRole('button', { name: '把厨下净水 出水TDS加进来' }).click();
  await page.getByRole('button', { name: '确认加入' }).click();
  const sensorRow = page.locator('[data-smart-home-whitelisted="sensor.kitchen_purifier_tds"]');
  await expect(sensorRow).toBeVisible();
  await expect(sensorRow.getByRole('checkbox')).toHaveCount(0);

  await page.goto('/house/smart-home');
  await page.getByRole('button', { name: '客厅窗帘：关上' }).click();
  await expect(page.locator('[data-smart-home-device="cover.living_room_curtain"]')).toContainText('关着', { timeout: 3_000 });
  await page.goto('/house/smart-home/settings');
  await expect(page.locator('[data-smart-home-commands] li').first()).toContainText('客厅窗帘 · 关上');
  await expect(page.locator('[data-smart-home-commands] li').first()).toContainText('成功');
});
