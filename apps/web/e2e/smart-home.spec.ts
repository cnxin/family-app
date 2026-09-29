import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession } from './helpers';

// H3 E1：真 API + 假 Home Assistant（apps/api/scripts/fake-ha.mjs，本进程里起）。隔离库里不会有真的 HA，
// 但 API 到 HA 这一段照样走真实 HTTP，比拦截 /api/smart-home 更接近实际。
// 智能家居页重做 R1 起白名单按设备：目录里整台「加进来」，再在白名单里改名、改房间。

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
  const devices = await admin.get<{ id: string }[]>('/smart-home/devices');
  for (const device of devices) await admin.delete(`/smart-home/devices/${device.id}`);
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

  // 整台挑两样（名字、房间默认取 HA 里的），再在白名单里起中文名
  for (const [friendly, primary, name, area] of [
    ['客厅窗帘', 'cover.living_room_curtain', '客厅窗帘', '客厅'],
    ['Roborock S8', 'vacuum.roborock_s8', '扫地机', '客厅'],
  ]) {
    await page.getByRole('button', { name: `把${friendly}整台加进来` }).click();
    const row = page.locator(`[data-smart-home-whitelisted="${primary}"]`);
    await expect(row.getByLabel(`${friendly} 的中文名`)).toHaveValue(friendly);
    await expect(row.getByLabel(`${friendly} 的分组`)).toHaveValue(area);
    if (name !== friendly) {
      await row.getByLabel(`${friendly} 的中文名`).fill(name);
      await row.getByRole('button', { name: '保存' }).click();
      await expect(page.locator(`[data-smart-home-whitelisted="${primary}"]`).getByLabel(`${name} 的中文名`)).toHaveValue(name);
    }
  }
  await expect(page.locator('[data-smart-home-directory-device="Roborock S8"]')).toContainText('已加');

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

  // HA 停掉：这一页说连不上，设备照列、保留上次的状态，按钮收起；别的页面照常
  await ha.stop();
  await page.waitForTimeout(2_100);
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(page.getByRole('status').filter({ hasText: '连不上 Home Assistant' })).toContainText('暂时按不了');
  await expect(page.locator('[data-smart-home-connection="down"]')).toBeVisible();
  await expect(curtain).toContainText('开着');
  await page.goto('/house/shopping');
  await expect(page.getByRole('heading', { name: '购物清单' })).toBeVisible();
  if (!isMobile) await expect(page.getByText('连不上 Home Assistant')).toHaveCount(0);
});

test('普通成员：看得到设备和状态，看不到设置入口；设置页只给管理员', async ({ browser, page, request }) => {
  const admin = apiClient(request);
  await admin.put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  const purifier = await admin.post<{ id: string }>('/smart-home/devices', { haDeviceId: 'dev_purifier' });
  await admin.patch(`/smart-home/devices/${purifier.id}`, { displayName: 'RO滤芯', area: '厨房' });
  const member = await freshMemberSession(request, '智能家居家人');
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  const memberPage = await context.newPage();
  await seedSession(memberPage, member);
  try {
    await memberPage.goto('/house/smart-home');
    const filter = memberPage.locator('[data-smart-home-device="sensor.kitchen_purifier_ro_filter_life"]');
    await expect(filter).toContainText('RO滤芯');
    await expect(filter).toContainText('12%');
    await expect(memberPage.getByRole('link', { name: '连接与设备设置' })).toHaveCount(0);
    await memberPage.goto('/house/smart-home/settings');
    await expect(memberPage.getByText('这一页只有家庭管理员能改')).toBeVisible();
  } finally {
    await context.close();
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});

test('实体目录按设备分组：默认只摆主实体、诊断类折进「更多」，搜索与类型筛选生效，整台加进来带默认搭配', async ({
  page,
  request,
}) => {
  await apiClient(request).put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  await page.goto('/house/smart-home/settings');
  const card = (name: string) => page.locator(`[data-smart-home-directory-device="${name}"]`);
  const entity = (id: string) => page.locator(`[data-smart-home-entity="${id}"]`);

  // 3 台设备各一张卡，标题带区域
  await expect(card('厨下净水')).toBeVisible();
  await expect(card('客厅窗帘')).toBeVisible();
  await expect(card('Roborock S8')).toBeVisible();
  await expect(card('厨下净水')).toContainText('厨房');

  // 默认折叠：净水器 3 个主实体摆出来，WiFi / 固件两个诊断项收在「更多 2 项」里；实体名去掉了设备名前缀
  await expect(entity('binary_sensor.kitchen_purifier_ro_expiring')).toBeVisible();
  await expect(entity('binary_sensor.kitchen_purifier_ro_expiring')).toContainText('RO到期预警');
  await expect(entity('binary_sensor.kitchen_purifier_ro_expiring')).not.toContainText('厨下净水 RO到期预警');
  await expect(card('厨下净水').locator('[data-smart-home-entity]')).toHaveCount(3);
  await expect(entity('sensor.kitchen_purifier_firmware')).toHaveCount(0);
  await expect(card('客厅窗帘').locator('[data-smart-home-entity]')).toHaveCount(1);
  await card('厨下净水').getByRole('button', { name: /更多 2 项/ }).click();
  await expect(entity('sensor.kitchen_purifier_firmware')).toBeVisible();
  await expect(card('厨下净水').locator('[data-smart-home-entity]')).toHaveCount(5);

  // 米家插座那种不标诊断类别的设备：最多展开 4 个（开关优先），其余包括「* 」开头的内部实体都折起来；
  // HA 自己的服务型设备（Backup、Sun）和隐藏 / 停用的实体不出现
  await expect(card('防潮箱').locator('[data-smart-home-entity]')).toHaveCount(4);
  await expect(entity('switch.dehumidify_box')).toBeVisible();
  await expect(entity('switch.dehumidify_box_loop')).toHaveCount(0);
  await expect(card('防潮箱').getByRole('button', { name: /更多 4 项/ })).toBeVisible();
  await expect(card('Backup')).toHaveCount(0);
  await expect(card('Sun')).toHaveCount(0);
  await expect(entity('sensor.dehumidify_box_hidden')).toHaveCount(0);

  // 整张卡可以收起
  await card('客厅窗帘').getByRole('button', { name: /客厅窗帘/ }).first().click();
  await expect(entity('cover.living_room_curtain')).toHaveCount(0);

  // 搜索：搜到诊断类实体直接摆出来，别的设备不显示
  const search = page.getByLabel('搜设备或实体');
  await search.fill('固件');
  await expect(page.locator('[data-smart-home-directory-device]')).toHaveCount(1);
  await expect(entity('sensor.kitchen_purifier_firmware')).toBeVisible();
  await search.fill('select.roborock');
  await expect(page.locator('[data-smart-home-directory-device]')).toHaveCount(1);
  await expect(entity('select.roborock_s8_mop_intensity')).toBeVisible();
  await search.fill('');

  // 类型筛选：扫地机只剩 Roborock 的本体；传感器下窗帘只剩折起来的两个诊断项
  const chips = page.getByRole('group', { name: '按类型筛' });
  await chips.getByRole('button', { name: '扫地机', exact: true }).click();
  await expect(page.locator('[data-smart-home-directory-device]')).toHaveCount(1);
  await expect(entity('vacuum.roborock_s8')).toBeVisible();
  await expect(card('Roborock S8').getByRole('button', { name: /更多/ })).toHaveCount(0);
  await chips.getByRole('button', { name: '传感器', exact: true }).click();
  await expect(page.locator('[data-smart-home-directory-device]')).toHaveCount(4);
  await expect(card('客厅窗帘').locator('[data-smart-home-entity]')).toHaveCount(0);
  await expect(card('客厅窗帘').getByRole('button', { name: /更多 2 项/ })).toBeVisible();
  await chips.getByRole('button', { name: '全部', exact: true }).click();

  // 整台加进来之前就标出默认搭配：净水器（家电）主实体是滤芯寿命，另外两个传感器做主面板项
  await expect(entity('sensor.kitchen_purifier_ro_filter_life').locator('[data-smart-home-default-role="primary"]')).toBeVisible();
  await expect(entity('binary_sensor.kitchen_purifier_ro_expiring').locator('[data-smart-home-default-role="featured"]')).toBeVisible();
  await expect(entity('vacuum.roborock_s8').locator('[data-smart-home-default-role="primary"]')).toBeVisible();

  // 整台加进来：名字、房间取 HA 里的；卡上标「已加」，不再有「加进来」；属于设备的实体没有单独的「加进来」
  await expect(page.getByRole('button', { name: '把厨下净水 RO到期预警加进来' })).toHaveCount(0);
  await page.getByRole('button', { name: '把厨下净水整台加进来' }).click();
  await expect(card('厨下净水')).toContainText('已加');
  await expect(page.getByRole('button', { name: '把厨下净水整台加进来' })).toHaveCount(0);
  await expect(page.locator('[data-smart-home-whitelisted="sensor.kitchen_purifier_ro_filter_life"] input').first()).toHaveValue('厨下净水');
  await expect(page.locator('[data-smart-home-whitelisted="sensor.kitchen_purifier_ro_filter_life"]')).toContainText('主面板项 2 个');

  // 没有归属设备的实体（场景）还是一个一个加
  await page.getByRole('button', { name: '把电影之夜加进来' }).click();
  await expect(page.locator('[data-smart-home-whitelisted="scene.movie_night"]')).toBeVisible();
});
