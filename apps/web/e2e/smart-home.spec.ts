import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession } from './helpers';

// H3 E1：真 API + 假 Home Assistant（apps/api/scripts/fake-ha.mjs，本进程里起）。隔离库里不会有真的 HA，
// 但 API 到 HA 这一段照样走真实 HTTP，比拦截 /api/smart-home 更接近实际。

interface FakeHomeAssistant {
  url: string;
  states: { entity_id: string; state: string; attributes: Record<string, unknown> }[];
  stop(): Promise<void>;
}

// 运行时再加载、类型在这里声明：前端镜像只带 apps/web，构建时的 tsc 看不到 apps/api/scripts
const FAKE_HA_MODULE = new URL('../../api/scripts/fake-ha.mjs', import.meta.url).href;
async function startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant> {
  const module = (await import(FAKE_HA_MODULE)) as {
    startFakeHomeAssistant(options: { token: string }): Promise<FakeHomeAssistant>;
  };
  return module.startFakeHomeAssistant(options);
}

const TOKEN = 'e2e-home-assistant-long-lived-token-0001';

async function cleanSmartHome(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  const devices = await admin.get<{ entityId: string }[]>('/smart-home/devices');
  for (const device of devices) await admin.delete(`/smart-home/devices/${device.entityId}`);
  await request.delete(`${apiURL}/smart-home/connector-settings`, { headers }); // 没有家庭设置时 404，无所谓
}

let ha: FakeHomeAssistant;

test.beforeEach(async ({ request }) => {
  ha = await startFakeHomeAssistant({ token: TOKEN });
  await cleanSmartHome(request);
});

test.afterEach(async ({ request }) => {
  await cleanSmartHome(request);
  await ha.stop();
});

test('管理员连上 HA、挑设备起中文名；家里页出现智能家居，页面显示真实状态；HA 停掉只这一页说连不上', async ({
  page,
  isMobile,
}) => {
  await page.goto('/house/smart-home');
  await expect(page.getByText('还没连上 Home Assistant', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '去填地址和令牌' }).click();
  await expect(page).toHaveURL(/\/house\/smart-home\/settings$/);

  // 填地址和令牌，保存并测试
  await page.getByLabel('Home Assistant 地址').fill(ha.url);
  await page.getByLabel('Home Assistant 长期访问令牌').fill(TOKEN);
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.getByText('连接成功 · Home Assistant 2026.9.4')).toBeVisible();
  await expect(page.getByText(`****${TOKEN.slice(-4)}`)).toBeVisible();

  // 目录：门锁、安防、人员位置不列
  const directory = page.locator('[data-smart-home-entity]');
  await expect(directory.first()).toBeVisible();
  await expect(page.locator('[data-smart-home-entity="lock.front_door"]')).toHaveCount(0);
  await expect(page.locator('[data-smart-home-entity="alarm_control_panel.home"]')).toHaveCount(0);
  await expect(page.locator('[data-smart-home-entity="person.dad"]')).toHaveCount(0);

  // 挑两样，起中文名、分组
  for (const [friendly, name, area] of [
    ['客厅窗帘', '客厅窗帘', '客厅'],
    ['Roborock S8', '扫地机', '客厅'],
  ]) {
    await page.getByRole('button', { name: `把${friendly}加进来` }).click();
    await page.getByLabel(`${friendly} 的中文名`).fill(name);
    await page.getByLabel(`${friendly} 的分组`).fill(area);
    await page.getByRole('button', { name: '确认加入' }).click();
    await expect(page.locator('[data-smart-home-whitelisted]').filter({ has: page.locator(`input[value="${name}"]`) })).toBeVisible();
  }
  await expect(page.locator('[data-smart-home-entity="vacuum.roborock_s8"]')).toContainText('已加入');

  // 家里页：智能家居从「还可以开启」变成在用的图块
  await page.goto('/home');
  await expect(page.locator('[data-home-grid]').getByRole('link', { name: '智能家居', exact: true })).toBeVisible();
  await page.locator('[data-home-grid]').getByRole('link', { name: '智能家居', exact: true }).click();
  await expect(page).toHaveURL(/\/house\/smart-home$/);

  // 只读页：按分组铺开，状态说人话
  const curtain = page.locator('[data-smart-home-device="cover.living_room_curtain"]');
  const vacuum = page.locator('[data-smart-home-device="vacuum.roborock_s8"]');
  await expect(page.getByRole('heading', { name: '客厅' })).toBeVisible();
  await expect(curtain).toContainText('客厅窗帘');
  await expect(curtain).toContainText('开着');
  await expect(curtain).toContainText('开了 80%');
  await expect(vacuum).toContainText('在充电座上');
  await expect(vacuum).toContainText('电量 100%');
  await expect(page.locator('[data-smart-home-connection="ok"]')).toBeVisible();

  // HA 状态变了，点刷新就读到新的（E1 不推送；服务端缓存 2 秒）
  ha.states = ha.states.map((entry) =>
    entry.entity_id === 'vacuum.roborock_s8' ? { ...entry, state: 'cleaning' } : entry,
  );
  await page.waitForTimeout(2_100);
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(vacuum).toContainText('正在清扫');

  // HA 停掉：这一页说连不上，设备照列、状态一条横线；别的页面照常
  await ha.stop();
  await page.waitForTimeout(2_100);
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByRole('status').filter({ hasText: '连不上 Home Assistant' })).toBeVisible();
  await expect(page.locator('[data-smart-home-connection="down"]')).toBeVisible();
  await expect(curtain).toContainText('—');
  await page.goto('/house/shopping');
  await expect(page.getByRole('heading', { name: '购物清单' })).toBeVisible();
  if (!isMobile) await expect(page.getByText('连不上 Home Assistant')).toHaveCount(0);
});

test('普通成员：看得到设备和状态，看不到设置入口；设置页只给管理员', async ({ browser, page, request }) => {
  const admin = apiClient(request);
  await admin.put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  await admin.put('/smart-home/devices/sensor.water_purifier_filter_life', { displayName: '净水器滤芯', area: '厨房' });
  const member = await freshMemberSession(request, '智能家居家人');
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  const memberPage = await context.newPage();
  await seedSession(memberPage, member);
  try {
    await memberPage.goto('/house/smart-home');
    const filter = memberPage.locator('[data-smart-home-device="sensor.water_purifier_filter_life"]');
    await expect(filter).toContainText('净水器滤芯');
    await expect(filter).toContainText('12%');
    await expect(memberPage.getByRole('link', { name: '连接与设备设置' })).toHaveCount(0);
    await memberPage.goto('/house/smart-home/settings');
    await expect(memberPage.getByText('这一页只有家庭管理员能改')).toBeVisible();
  } finally {
    await context.close();
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});
