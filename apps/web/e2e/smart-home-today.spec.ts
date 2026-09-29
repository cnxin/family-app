import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, apiURL, expectNoHorizontalOverflow, watchPageErrors } from './helpers';

// H3 E5：今天页「家里的设备」、智能家居的留意卡、家里页图块状态行。真 API + 假 Home Assistant + 真 /events。
// 设备卡和详情就是智能家居页那一套（R2），这里只验今天页怎么用它们：最多 4 张、原地打开详情、断开时灰显加一行说明。

interface FakeHomeAssistant {
  url: string;
  setState(entityId: string, state: string, attributes?: Record<string, unknown>): void;
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

const TOKEN = 'e2e-home-assistant-long-lived-token-0006';
const FILTER_ENTITY = 'sensor.kitchen_purifier_ro_filter_life';
const DEVICES = [
  { haDeviceId: 'dev_roborock', displayName: '扫地机', area: '客厅', sortOrder: 1, controllable: true },
  { haDeviceId: 'dev_curtain', displayName: '客厅窗帘', area: '客厅', sortOrder: 2, controllable: true },
  { haDeviceId: 'dev_ac', displayName: '空调', area: '客厅', sortOrder: 3, controllable: true },
  // 净水器名下没有能控的东西，开不了控制
  { haDeviceId: 'dev_purifier', displayName: '厨下净水', area: '客厅', sortOrder: 4, controllable: false },
  { haDeviceId: 'dev_box', displayName: '防潮箱', area: '客厅', sortOrder: 5, controllable: true },
];
let ha: FakeHomeAssistant;
const ids: Record<string, string> = {};

const RULES_OFF = {
  laundry: { enabled: true, washer: null, dryer: null, doneValue: null },
  vacuum: { enabled: true, trigger: null },
  filter: { enabled: true, trigger: null, threshold: 10 },
};

async function cleanSmartHome(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  // E3 规则引用着设备时移不出白名单，先把规则清掉
  await admin.put('/smart-home/webhook-settings/rules', RULES_OFF);
  for (const device of await admin.get<{ id: string }[]>('/smart-home/devices')) {
    await admin.delete(`/smart-home/devices/${device.id}`);
  }
  await request.delete(`${apiURL}/smart-home/connector-settings`, { headers });
}

async function shot(page: Page, name: string) {
  const dir = resolve(process.cwd(), '../../.tmp-shots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), animations: 'disabled' });
}

test.beforeEach(async ({ request }) => {
  ha = await startFakeHomeAssistant({ token: TOKEN });
  await cleanSmartHome(request);
  const admin = apiClient(request);
  await admin.put('/smart-home/connector-settings', { baseUrl: ha.url, credential: TOKEN });
  for (const { haDeviceId, ...patch } of DEVICES) {
    const device = await admin.post<{ id: string }>('/smart-home/devices', { haDeviceId });
    await admin.patch(`/smart-home/devices/${device.id}`, { ...patch, pinnedToToday: true, minRole: 'member' });
    ids[patch.displayName] = device.id;
  }
});

test.afterEach(async ({ request }) => {
  await cleanSmartHome(request);
  await ha.stop();
});

for (const theme of ['light', 'dark'] as const) {
  test(`今天页「家里的设备」：最多 4 张、全部 N 台、原地打开详情（${theme}，截图）`, async ({ page, isMobile }) => {
    const errors = watchPageErrors(page);
    await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const block = page.locator('[data-today-devices]');
    await expect(block.getByRole('heading', { name: '家里的设备' })).toBeVisible();
    await expect(block.locator('[data-smart-home-device]')).toHaveCount(4);
    await expect(block.getByRole('button', { name: '打开防潮箱的详情' })).toHaveCount(0);
    await expect(block.getByRole('link', { name: '全部 5 台 ›' })).toHaveAttribute('href', '/house/smart-home');
    // 位置：「今天吃什么」之后、「今日待办」之前
    const order = await page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      const heading = (text: string) =>
        [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === text)?.getBoundingClientRect().top ?? -1;
      return [heading('今天吃什么'), top('[data-today-devices]'), heading('今日待办')];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    await expect(block.locator('[data-smart-home-device="vacuum.roborock_s8"]')).toContainText('扫地机');
    await expect(block.getByRole('button', { name: /扫地机：/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectNoHorizontalOverflow(page);
    // 手机上底部有标签栏：把区块滚到中间，四张卡都露出来
    await block.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await shot(page, `e5-today-${isMobile ? '390x844' : '1280x800'}-${theme}.png`);

    await block.getByRole('button', { name: '打开扫地机的详情' }).click();
    const panel = page.getByRole('dialog', { name: '扫地机' });
    await expect(panel.getByRole('heading', { name: '扫地机' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('HA 断开：区块里一行说明、卡片灰显收起主按钮；一台都不勾时整块不出现', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '链路在桌面项目验一次');
  await page.goto('/');
  const block = page.locator('[data-today-devices]');
  await expect(block.getByRole('button', { name: /扫地机：/ })).toBeVisible();
  await ha.stop();
  await expect(block.getByRole('status')).toContainText('连不上 Home Assistant，下面是', { timeout: 8_000 });
  await expect(block.getByRole('button', { name: /扫地机：/ })).toHaveCount(0);
  await expect(block.locator('[data-smart-home-device]')).toHaveCount(4);
  const admin = apiClient(request);
  for (const id of Object.values(ids)) await admin.patch(`/smart-home/devices/${id}`, { pinnedToToday: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: '今日待办' })).toBeVisible();
  await expect(block).toHaveCount(0);
});

test('家里页图块写设备状况；滤芯低进「需要留意」，点「看滤芯」直接打开那台的详情', async ({ page, request, isMobile }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '链路在桌面项目验一次');
  // 家里页不为图块拉列表：状态行用今天页读过的设备状态，所以先经过今天页
  await page.goto('/');
  await expect(page.locator('[data-today-devices]')).toBeVisible();
  await (isMobile ? page.getByRole('link', { name: '家里' }) : page.getByRole('link', { name: '家里（全部功能）' })).click();
  const tile = page.locator('[data-home-tile="smart-home"]');
  await expect(tile.locator('[data-home-status]')).toHaveText(/^5 台设备 · /);

  await apiClient(request).put('/smart-home/webhook-settings/rules', {
    ...RULES_OFF,
    filter: { enabled: true, trigger: { deviceId: ids['厨下净水'], entityId: FILTER_ENTITY }, threshold: 10 },
  });
  ha.setState(FILTER_ENTITY, '6', { unit_of_measurement: '%', friendly_name: '厨下净水 RO滤芯寿命' });
  await page.goto('/');
  const attention = page.locator('[data-today-attention]');
  // 留意最多 5 张、智能家居排在后面：种子数据多时先把前面的点「稍后」
  const card = attention.locator('[data-attention-card]').filter({ hasText: '厨下净水的滤芯快用完了' });
  await expect(attention.getByRole('heading', { name: '需要留意' })).toBeVisible();
  for (let index = 0; index < 10 && !(await card.count()); index += 1) {
    await attention.getByRole('button', { name: '稍后' }).first().click();
    await page.waitForTimeout(200);
  }
  await expect(attention).toContainText('厨下净水的滤芯快用完了', { timeout: 5_000 });
  await attention.getByRole('link', { name: '看滤芯' }).click();
  await expect(page).toHaveURL(new RegExp(`/house/smart-home\\?device=${ids['厨下净水']}$`));
  const panel = page.getByRole('dialog', { name: '厨下净水' });
  await expect(panel.getByRole('heading', { name: '厨下净水' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/house\/smart-home$/);

  // 有留意时图块先说留意（「稍后」只藏今天页的卡，家里图块照样说）
  await page.getByRole('link', { name: '家里（全部功能）' }).click();
  await expect(tile.locator('[data-home-status]')).toHaveText('厨下净水的滤芯快用完了');
});
