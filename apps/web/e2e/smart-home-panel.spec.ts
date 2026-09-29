import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiClient, apiURL, freshMemberSession, seedSession } from './helpers';

// 智能家居重做 R3：详情面板（smart-home-redesign §9）。真 API + 假 Home Assistant + 真 /events。
// 验「发命令的节奏」（点一下就发 / 滑块松手才发 / 键盘和步进停手 0.6 秒才发、连按合并 / 发出后锁住直到回推或超时）、
// 排除项不出按钮、成员只读、新实体待确认、分房间、手机 sheet 的两档。

interface FakeHomeAssistant {
  url: string;
  states: { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed?: string }[];
  entityRegistry: Record<string, unknown>[];
  serviceMode: 'ok' | 'fail' | 'hang';
  serviceCalls: { domain: string; service: string; data: Record<string, unknown> }[];
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

const TOKEN = 'e2e-home-assistant-long-lived-token-0003';
let ha: FakeHomeAssistant;
const ids = { vacuum: '', curtain: '', ac: '' };

async function cleanSmartHome(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  for (const device of await admin.get<{ id: string }[]>('/smart-home/devices')) {
    await admin.delete(`/smart-home/devices/${device.id}`);
  }
  await request.delete(`${apiURL}/smart-home/connector-settings`, { headers });
}

async function addDevice(request: APIRequestContext, body: Record<string, string>, patch: Record<string, unknown>) {
  const admin = apiClient(request);
  const device = await admin.post<{ id: string }>('/smart-home/devices', body);
  await admin.patch(`/smart-home/devices/${device.id}`, patch);
  return device.id;
}

const calls = (service: string) => ha.serviceCalls.filter((call) => call.service === service);

/** 打开详情；手机上 sheet 先停在约 60%，下半截看不见，拉到全屏再操作。 */
async function openDetail(page: Page, name: string, { expand = true } = {}) {
  await page.goto('/house/smart-home');
  await page.getByRole('button', { name: `打开${name}的详情` }).click();
  const panel = page.getByRole('dialog', { name });
  await expect(panel.getByRole('heading', { name })).toBeVisible();
  const toFull = panel.getByRole('button', { name: '拉到全屏' });
  if (expand && (await toFull.count())) {
    await toFull.click();
    await expect(panel).toHaveAttribute('data-sheet-detent', 'full');
    await expect(panel).toHaveAttribute('data-sheet-settled', 'true');
  }
  return panel;
}

test.beforeEach(async ({ request }) => {
  ha = await startFakeHomeAssistant({ token: TOKEN });
  await cleanSmartHome(request);
  await apiClient(request).put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  ids.vacuum = await addDevice(request, { haDeviceId: 'dev_roborock' }, {
    displayName: '扫地机',
    area: '客厅',
    controllable: true,
    minRole: 'member',
    featuredEntityIds: ['select.roborock_s8_mop_intensity', 'sensor.roborock_s8_filter_left'],
  });
  ids.curtain = await addDevice(request, { haDeviceId: 'dev_curtain' }, { displayName: '客厅窗帘', area: '客厅', controllable: true });
  ids.ac = await addDevice(request, { haDeviceId: 'dev_ac' }, { displayName: '空调', area: '卧室', controllable: true });
});

test.afterEach(async ({ request }) => {
  await cleanSmartHome(request);
  await ha.stop();
});

test('扫地机详情：吸力、拖地强度点一下就发；分房间选好再发；例程按钮能按；「重置」按钮不出现', async ({ page }) => {
  const panel = await openDetail(page, '扫地机');
  await expect(panel.locator('[data-smart-home-big-status]')).toHaveText('在充电座上 · 电量 100%');

  // 吸力：vacuum 本体的 fan_speed_list，中文来自 HA 的翻译；点一下就发，回推后选中
  await panel.getByRole('radio', { name: '强力' }).click();
  await expect.poll(() => calls('set_fan_speed').map((call) => call.data.fan_speed)).toEqual(['turbo']);
  await expect(panel.getByRole('radio', { name: '强力' })).toHaveAttribute('aria-checked', 'true', { timeout: 3_000 });

  // 主面板项里的拖地强度（config 类 select，管理员提上来的）
  await panel.getByRole('radio', { name: '高' }).click();
  await expect.poll(() => calls('select_option').map((call) => call.data.option)).toEqual(['high']);

  // 分房间：房间 = HA 里对应过分区的区域；选房间不发，点按钮才发
  await expect(panel.getByRole('button', { name: '先选房间' })).toBeDisabled();
  await panel.getByRole('group', { name: '选要扫的房间' }).getByRole('button', { name: /厨房/ }).click();
  expect(calls('clean_area')).toHaveLength(0);
  await panel.getByRole('button', { name: '清扫选中的 1 个房间' }).click();
  await expect.poll(() => calls('clean_area').map((call) => call.data.cleaning_area_id)).toEqual([['kitchen']]);

  // 更多设置：例程按钮能按；设备信息：「重置」只列名字、不出按钮
  await panel.getByText('更多设置').click();
  await panel.getByRole('button', { name: '饭后打扫：按一下' }).click();
  await expect.poll(() => calls('press').length).toBe(1);
  await panel.getByText('设备信息').click();
  await expect(panel.locator('[data-smart-home-excluded="button.roborock_s8_reset_filter"]')).toContainText('此操作请在厂商 App 完成');
  await expect(panel.getByRole('button', { name: /重置/ })).toHaveCount(0);

  // 最近操作全家可见，新的在前
  await expect(panel.locator('[data-smart-home-recent] li').first()).toContainText('饭后打扫', { timeout: 3_000 });
});

test('窗帘位置：拖动时不发、松手才发；键盘调节停手 0.6 秒才发', async ({ page }) => {
  const panel = await openDetail(page, '客厅窗帘');
  const slider = panel.getByRole('slider', { name: '窗帘位置' });
  await expect(slider).toHaveAttribute('aria-valuenow', '80');
  const box = (await slider.boundingBox())!;
  const at = (fraction: number) => [box.x + box.width * fraction, box.y + box.height / 2] as const;

  await page.mouse.move(...at(0.8));
  await page.mouse.down();
  await page.mouse.move(...at(0.5), { steps: 5 });
  await page.mouse.move(...at(0.3), { steps: 5 });
  await expect(slider).toHaveAttribute('aria-valuenow', /^(2[89]|3[0-2])$/);
  expect(calls('set_cover_position')).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => calls('set_cover_position').length).toBe(1);
  const sent = calls('set_cover_position')[0].data.position as number;
  expect(sent).toBeGreaterThanOrEqual(28);
  expect(sent).toBeLessThanOrEqual(32);
  await expect(slider).toHaveAttribute('aria-valuenow', String(sent), { timeout: 3_000 });
  // 拖动的预览早就是这个值了，上面那句不代表回推到了：等锁放开再按键，否则按键落在锁住的滑块上被吃掉
  await expect(slider).not.toHaveAttribute('aria-busy', 'true', { timeout: 3_000 });

  // 键盘：方向键只动预览，停手 0.6 秒发一次（发最终值）
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(calls('set_cover_position')).toHaveLength(1);
  await expect.poll(() => calls('set_cover_position').length).toBe(2);
  expect(calls('set_cover_position')[1].data.position).toBe(sent + 3);
});

test('空调：目标温度连按合并成一次（按 HA 步长发绝对值）；风速、摆风点一下就发', async ({ page }) => {
  const panel = await openDetail(page, '空调');
  await expect(page.getByText('≈ 按上次操作显示')).toBeVisible();
  const plus = panel.getByRole('button', { name: '目标温度：加' });
  await plus.click();
  await plus.click();
  await plus.click();
  await expect(panel.getByRole('group', { name: '目标温度' })).toContainText('29°');
  await expect.poll(() => calls('set_temperature').map((call) => call.data.temperature)).toEqual([29]);
  await panel.getByRole('radio', { name: '高' }).click();
  await expect.poll(() => calls('set_fan_mode').map((call) => call.data.fan_mode)).toEqual(['高']);
  await panel.getByRole('radio', { name: '上下摆' }).click();
  await expect.poll(() => calls('set_swing_mode').map((call) => call.data.swing_mode)).toEqual(['vertical']);
});

test('家人：只给管理员的设备只读（没有更多设置和管理）；全家能控的照常能按', async ({ browser, page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '权限在桌面项目验一次');
  const member = await freshMemberSession(request, '详情家人');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: page.viewportSize() ?? undefined });
  const memberPage = await context.newPage();
  await seedSession(memberPage, member);
  try {
    const ac = await openDetail(memberPage, '空调');
    await expect(ac.getByText('这台只有管理员能控制')).toBeVisible();
    await expect(ac.getByRole('switch')).toHaveCount(0);
    await expect(ac.getByText('更多设置')).toHaveCount(0);
    await expect(ac.getByText('管理', { exact: true })).toHaveCount(0);
    await memberPage.keyboard.press('Escape');
    const vacuum = await openDetail(memberPage, '扫地机');
    await vacuum.getByRole('radio', { name: '安静' }).click();
    await expect.poll(() => calls('set_fan_speed').map((call) => call.data.fan_speed)).toEqual(['quiet']);
  } finally {
    await context.close();
    await apiClient(request).patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});

test('HA 新冒出来的子实体：默认藏着，管理员在详情「管理」里放出来后出现在更多设置', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '链路在桌面项目验一次');
  ha.entityRegistry = [
    ...ha.entityRegistry,
    { entity_id: 'switch.roborock_s8_new_feature', device_id: 'dev_roborock', area_id: null, entity_category: null, disabled_by: null, hidden_by: null },
  ];
  ha.states = [
    ...ha.states,
    { entity_id: 'switch.roborock_s8_new_feature', state: 'off', attributes: { friendly_name: 'Roborock S8 新功能' } },
  ];
  await apiClient(request).put('/smart-home/connector-settings', { isEnabled: true }); // 丢掉注册表缓存
  const panel = await openDetail(page, '扫地机');
  const pending = panel.locator('[data-smart-home-pending]');
  await expect(pending).toContainText('1 个新实体待确认');
  await expect(pending).toContainText('新功能');
  await panel.getByText('更多设置').click();
  await expect(panel.locator('[data-smart-home-entity-row="switch.roborock_s8_new_feature"]')).toHaveCount(0);
  await pending.getByRole('button', { name: '放出来' }).click();
  await expect(panel.locator('[data-smart-home-entity-row="switch.roborock_s8_new_feature"]')).toBeVisible({ timeout: 3_000 });
  await expect(panel.locator('[data-smart-home-pending]')).toHaveCount(0);
});

test('HA 不回：发出后这一个控件锁住，别的控件照常；最多 8 秒后放开并提示', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '要等 8 秒，只在桌面项目验一次');
  test.setTimeout(40_000);
  const panel = await openDetail(page, '扫地机');
  ha.serviceMode = 'hang';
  await panel.getByRole('radio', { name: '最大' }).click();
  const speeds = panel.getByRole('radiogroup', { name: '吸力' });
  await expect(speeds).toHaveAttribute('aria-busy', 'true');
  await expect(panel.getByRole('radio', { name: '安静' })).toBeDisabled();
  // 同一台设备的其他子实体照常能按
  await expect(panel.getByRole('radio', { name: '低' })).toBeEnabled();
  await expect(speeds).not.toHaveAttribute('aria-busy', 'true', { timeout: 12_000 });
  await expect(panel.getByRole('radio', { name: '安静' })).toBeEnabled();
  ha.serviceMode = 'ok';
});

test('手机 sheet：打开停在约 60%，上拉到全屏，下拉到底关闭', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chrome', '两档 sheet 只在手机上');
  await openDetail(page, '扫地机', { expand: false });
  const sheet = page.locator('[data-sheet-detent]');
  await expect(sheet).toHaveAttribute('data-sheet-detent', 'medium');
  await expect(sheet).toHaveAttribute('data-sheet-settled', 'true');
  const handle = (await page.locator('[data-sheet-handle]').boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 260, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute('data-sheet-detent', 'full');
  await expect(sheet).toHaveAttribute('data-sheet-settled', 'true');
  const top = (await page.locator('[data-sheet-handle]').boundingBox())!;
  await page.mouse.move(x, top.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, top.y + 700, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-smart-home-panel]')).toHaveCount(0, { timeout: 3_000 });
});
