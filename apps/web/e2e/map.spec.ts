import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, authFiles, expectNoHorizontalOverflow, stamp, watchPageErrors } from './helpers';

// I2 家庭地图（docs/item-location-plan.md §3 I2b）：手画导入 → 看模式（手机双指缩放、单指平移、点房间出抽屉、
// 点柜子看东西、搜索高亮）→ 编辑模式（管理员；桌面拖柜子防抖保存、改名、画新柜子；手机只改名拖柜子）。
// 地图一家一张：每条用例开头 PUT /map 清掉形状，自己造房间。

interface Location { id: string; name: string; pathLabel: string }

const shots = resolve(process.cwd(), '../../.tmp-shots');
const sample = resolve(process.cwd(), '../../docs/ui-prototypes/floorplan-robot-sample.png');

async function setupMap(request: APIRequestContext, tag: string) {
  const admin = apiClient(request);
  await admin.put('/map', { viewBox: { w: 1000, h: 1000 }, clearShapes: true });
  const living = await admin.post<Location>('/locations', { name: `客厅${tag}` });
  const bedroom = await admin.post<Location>('/locations', { name: `卧室${tag}` });
  const cabinet = await admin.post<Location>('/locations', { parentId: living.id, name: '电视柜', kind: 'container' });
  const layer = await admin.post<Location>('/locations', { parentId: cabinet.id, name: '第二层' });
  await admin.patch(`/locations/${living.id}/shape`, { mapShape: { type: 'polygon', points: [[80, 80], [620, 80], [620, 480], [80, 480]] } });
  await admin.patch(`/locations/${bedroom.id}/shape`, {
    mapShape: { type: 'polygon', points: [[80, 500], [620, 500], [620, 700], [400, 700], [400, 920], [80, 920]] },
  });
  await admin.patch(`/locations/${cabinet.id}/shape`, { mapShape: { type: 'rect', x: 120, y: 380, w: 220, h: 70 } });
  const item = await admin.post<{ id: string; name: string }>('/inventory-items', {
    name: stamp('遥控器电池'), category: '其他', quantity: 4, unit: '节', lowStockThreshold: 0, restockQuantity: 4,
    defaultLocationId: layer.id,
  });
  return { living, bedroom, cabinet, layer, item };
}

async function cleanup(request: APIRequestContext, ids: string[], itemId?: string) {
  const admin = apiClient(request);
  if (itemId) await admin.delete(`/inventory-items/${itemId}`).catch(() => undefined);
  for (const id of ids) await admin.post(`/locations/${id}/archive`, {}).catch(() => undefined);
}

async function mapTransform(page: Page) {
  const value = await page.locator('[data-map-canvas] svg > g').first().getAttribute('transform');
  const [, x, y, scale] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(value ?? '') ?? [];
  return { x: Number(x), y: Number(y), scale: Number(scale) };
}

/** 合成触摸指针事件：两根手指从中心往外张开（双指缩放），或一根手指拖（平移） */
async function touchGesture(page: Page, fingers: { from: [number, number]; to: [number, number] }[]) {
  await page.evaluate(async (list) => {
    const canvas = document.querySelector('[data-map-canvas]')!;
    const fire = (target: EventTarget, type: string, id: number, x: number, y: number) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: 0 }));
    list.forEach((finger, index) => fire(canvas, 'pointerdown', index + 1, ...finger.from));
    for (let step = 1; step <= 10; step += 1) {
      list.forEach((finger, index) => {
        const x = finger.from[0] + ((finger.to[0] - finger.from[0]) * step) / 10;
        const y = finger.from[1] + ((finger.to[1] - finger.from[1]) * step) / 10;
        fire(window, 'pointermove', index + 1, x, y);
      });
      await new Promise((done) => requestAnimationFrame(() => done(null)));
    }
    list.forEach((finger, index) => fire(window, 'pointerup', index + 1, ...finger.to));
  }, fingers);
  await page.waitForTimeout(700);
}

/** 切模式时工具条高度会变、画布跟着挪：等这块在屏幕上两次量的位置一样再操作 */
async function stableBox(locator: Locator) {
  let last = '';
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const now = JSON.stringify(box && [Math.round(box.x), Math.round(box.y), Math.round(box.width)]);
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [120] }).toBe(true);
  return (await locator.boundingBox())!;
}

async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(shots, name) });
}

test('手画导入：截图当底图 → 拖矩形画房间 → 起名字 → 地图页看到这些房间', async ({ page, request, isMobile }) => {
  test.skip(isMobile, '导入与画房间在电脑上做');
  const errors = watchPageErrors(page);
  const tag = randomUUID().slice(0, 4);
  const created: string[] = [];
  try {
    await page.goto('/house/map/import');
    await page.getByLabel('选择地图截图').setInputFiles(sample);
    await expect(page.locator('[data-import-crop] img')).toBeVisible();
    // 右下角的「地图显示」按钮裁掉：拖右下角的抓手往里收
    const grip = page.locator('[data-crop-grip="se"]');
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y - 20, { steps: 5 });
    await page.mouse.up();
    await shot(page, 'map-import-crop-desktop.png');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('[data-import-step="1"]')).toBeVisible();
    // 自动识别先出草稿（map-detect.spec 测）；这条走手画：清空了自己画
    await expect(page.locator('[data-detect-state="done"], [data-detect-state="failed"]')).toBeVisible({ timeout: 15_000 });
    const clear = page.getByRole('button', { name: '清空自己画' });
    if (await clear.isVisible()) await clear.click();
    // 这张裁法（右下角收进去）下识别要能出结果，不能掉到兜底
    await expect(page.locator('[data-detect-state]')).not.toContainText('Maximum call stack');
    await expect(page.getByRole('tab', { name: '画房间' })).toHaveAttribute('aria-selected', 'true');

    const canvas = page.locator('[data-map-canvas]');
    const area = (await canvas.boundingBox())!;
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(area.x + area.width * x1, area.y + area.height * y1);
      await page.mouse.down();
      await page.mouse.move(area.x + area.width * x2, area.y + area.height * y2, { steps: 6 });
      await page.mouse.up();
    };
    await drag(0.35, 0.1, 0.55, 0.3);
    await drag(0.35, 0.45, 0.55, 0.62);
    await expect(page.locator('[data-map-room]')).toHaveCount(2);
    await expect(page.getByText('2 个房间', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.locator('[data-import-step="2"]')).toBeVisible();
    await page.getByLabel('房间名字').fill(`阳台${tag}`);
    await page.getByRole('button', { name: '下一个' }).click();
    await page.getByLabel('房间名字').fill(`玄关${tag}`);
    await shot(page, 'map-import-name-desktop.png');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('[data-import-step="3"]')).toBeVisible();
    const saved = page.waitForResponse((response) => response.url().includes('/map/background') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '完成' }).click();
    expect((await saved).status()).toBe(201);
    await expect(page).toHaveURL(/\/house\/map$/);
    await expect(page.getByRole('button', { name: `阳台${tag}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `玄关${tag}`, exact: true })).toBeVisible();

    const admin = apiClient(request);
    const map = await admin.get<{ hasBackground: boolean; viewBox: { w: number; h: number } }>('/map');
    const rooms = (await admin.get<(Location & { mapShape: { type: string } | null })[]>('/locations')).filter((one) => one.name.endsWith(tag));
    created.push(...rooms.map((one) => one.id));
    expect(map.hasBackground).toBe(true);
    expect(map.viewBox.w).toBe(1000);
    expect(rooms.map((one) => one.mapShape?.type)).toEqual(['polygon', 'polygon']);
    expect(errors).toEqual([]);
  } finally {
    await cleanup(request, created);
  }
});

test('看模式：点房间出抽屉、点柜子看东西、搜索高亮、?focus= 对准', async ({ page, request, isMobile }) => {
  const errors = watchPageErrors(page);
  const tag = randomUUID().slice(0, 4);
  const places = await setupMap(request, tag);
  try {
    await page.goto('/house/map');
    const room = page.locator(`[data-map-room="${places.living.id}"]`);
    await expect(room).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (isMobile) await shot(page, 'map-view-mobile.png');

    await room.click();
    const drawer = page.locator(`[data-map-drawer="${places.living.id}"]`);
    await expect(drawer).toContainText('电视柜');
    if (isMobile) {
      await expect(page.locator('[data-sheet-settled="true"]')).toBeVisible();
      await shot(page, 'map-drawer-mobile.png');
    }
    await drawer.getByRole('button', { name: /电视柜/ }).click();
    const cabinet = page.locator(`[data-map-drawer="${places.cabinet.id}"]`);
    await expect(cabinet).toContainText('第二层');
    await expect(cabinet).toContainText(places.item.name);

    // 搜索：柜子在图上高亮，结果里写「上次放在」
    if (isMobile) await page.keyboard.press('Escape');
    await page.getByLabel('找东西').fill(places.item.name);
    await expect(page.locator('[data-map-hits]')).toContainText(`上次放在 ${places.layer.pathLabel}`);
    await expect(page.locator(`[data-map-container="${places.cabinet.id}"]`)).toHaveAttribute('data-hit', 'true');

    // 深链：?focus= 打开那个位置
    await page.goto(`/house/map?focus=${places.cabinet.id}`);
    await expect(page.locator(`[data-map-drawer="${places.cabinet.id}"]`)).toContainText(places.item.name);
    await expect(page).toHaveURL(/\/house\/map$/);
    expect(errors).toEqual([]);
  } finally {
    await cleanup(request, [places.living.id, places.bedroom.id], places.item.id);
  }
});

test('手机看模式：双指张开放大、单指拖动平移、松手后停在范围里', async ({ page, request, isMobile }) => {
  test.skip(!isMobile, '触摸手势');
  const tag = randomUUID().slice(0, 4);
  const places = await setupMap(request, tag);
  try {
    await page.goto('/house/map');
    await expect(page.locator(`[data-map-room="${places.living.id}"]`)).toBeVisible();
    const area = (await page.locator('[data-map-canvas]').boundingBox())!;
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const before = await mapTransform(page);
    await touchGesture(page, [
      { from: [cx - 30, cy], to: [cx - 110, cy] },
      { from: [cx + 30, cy], to: [cx + 110, cy] },
    ]);
    const zoomed = await mapTransform(page);
    expect(zoomed.scale).toBeGreaterThan(before.scale * 2);
    await touchGesture(page, [{ from: [cx, cy], to: [cx + 90, cy + 40] }]);
    const panned = await mapTransform(page);
    expect(panned.x).toBeGreaterThan(zoomed.x + 40);
    // 放大到头还往里捏：松手弹回上限，不会无限大
    await touchGesture(page, [
      { from: [cx - 10, cy], to: [cx - 170, cy] },
      { from: [cx + 10, cy], to: [cx + 170, cy] },
    ]);
    await touchGesture(page, [
      { from: [cx - 10, cy], to: [cx - 170, cy] },
      { from: [cx + 10, cy], to: [cx + 170, cy] },
    ]);
    const capped = await mapTransform(page);
    expect(capped.scale).toBeLessThanOrEqual(before.scale * 10 + 0.001);
    // 拖完那一下不算点房间
    await expect(page.locator('[data-map-drawer]')).toHaveCount(0);
    await page.getByRole('button', { name: '看全图' }).click();
    await expect.poll(async () => (await mapTransform(page)).scale).toBeLessThan(before.scale * 1.05);
  } finally {
    await cleanup(request, [places.living.id, places.bedroom.id], places.item.id);
  }
});

test('编辑模式：电脑拖柜子防抖保存、改名、画新柜子；手机只改名拖柜子', async ({ page, request, isMobile }) => {
  const errors = watchPageErrors(page);
  const tag = randomUUID().slice(0, 4);
  const places = await setupMap(request, tag);
  const admin = apiClient(request);
  try {
    await page.goto('/house/map');
    await page.getByRole('tab', { name: '编辑' }).click();
    await expect(page.locator('[data-map-canvas]')).toHaveAttribute('data-map-canvas', isMobile ? 'edit-containers' : 'edit-full');
    if (isMobile) {
      await expect(page.getByText('手机上只能改名和拖柜子')).toBeVisible();
      await expect(page.getByRole('tab', { name: '画房间' })).toHaveCount(0);
    }
    const cabinet = page.locator(`[data-map-container="${places.cabinet.id}"]`);
    await stableBox(cabinet);
    await cabinet.click();
    const box = await stableBox(cabinet);
    const patches: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes(`/locations/${places.cabinet.id}/shape`)) patches.push(response.status());
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 40, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => patches.length, { timeout: 5000 }).toBe(1);
    expect(patches).toEqual([200]);
    const moved = (await admin.get<(Location & { mapShape: { x: number; y: number } })[]>('/locations')).find((one) => one.id === places.cabinet.id)!;
    expect(moved.mapShape.x).toBeGreaterThan(120);
    expect(moved.mapShape.y).toBeLessThan(380);

    await page.locator('[data-map-edit-bar]').getByRole('button', { name: '改名' }).click();
    await page.getByLabel('新名字').fill(`电视柜${tag}`);
    await page.getByRole('button', { name: '好' }).click();
    await expect(page.getByRole('button', { name: `电视柜${tag}` }).first()).toBeVisible();

    if (!isMobile) {
      await page.getByRole('tab', { name: '画柜子' }).click();
      const bedroom = (await page.locator(`[data-map-room="${places.bedroom.id}"]`).boundingBox())!;
      await page.mouse.move(bedroom.x + 30, bedroom.y + 20);
      await page.mouse.down();
      await page.mouse.move(bedroom.x + 110, bedroom.y + 60, { steps: 6 });
      await page.mouse.up();
      const dialog = page.getByRole('dialog', { name: '这是哪个柜子？' });
      await dialog.getByRole('button', { name: '衣柜' }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () =>
        (await admin.get<(Location & { parentId: string; mapShape: unknown })[]>('/locations')).some(
          (one) => one.parentId === places.bedroom.id && one.name === '衣柜' && one.mapShape,
        ),
      ).toBe(true);
      await page.locator(`[data-map-room="${places.bedroom.id}"]`).click();
      await page.getByRole('tab', { name: '选择' }).click();
      await page.locator(`[data-map-room="${places.bedroom.id}"]`).click();
      await expect(page.locator('[data-map-vertex]')).toHaveCount(6);
      await shot(page, 'map-edit-desktop.png');
    }
    expect(errors).toEqual([]);
  } finally {
    await cleanup(request, [places.living.id, places.bedroom.id], places.item.id);
  }
});

test('家人只有看模式：没有「编辑」和「重新导入」', async ({ page, request }) => {
  const tag = randomUUID().slice(0, 4);
  const places = await setupMap(request, tag);
  try {
    const session = JSON.parse(readFileSync(authFiles.sessions, 'utf8'))['妈妈'];
    await page.addInitScript((value) => localStorage.setItem('family-app.session', JSON.stringify(value)), session);
    await page.goto('/house/map');
    await expect(page.locator(`[data-map-room="${places.living.id}"]`)).toBeVisible();
    await expect(page.getByRole('tab', { name: '编辑' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '重新导入' })).toHaveCount(0);
    await page.locator(`[data-map-room="${places.living.id}"]`).click();
    await expect(page.locator(`[data-map-drawer="${places.living.id}"]`)).toContainText('电视柜');
  } finally {
    await cleanup(request, [places.living.id, places.bedroom.id], places.item.id);
  }
});

test('管理员导出地图：下载一个 JSON，带房间形状和底图', async ({ page, request, isMobile }) => {
  test.skip(isMobile, '导出按钮在电脑上');
  const tag = randomUUID().slice(0, 4);
  const places = await setupMap(request, tag);
  try {
    await page.goto('/house/map');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^家庭地图-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await file.path())!, 'utf8'));
    expect(data.locations.find((one: { id: string }) => one.id === places.living.id).mapShape.type).toBe('polygon');
    expect(data.map.viewBox.w).toBe(1000);
  } finally {
    await cleanup(request, [places.living.id, places.bedroom.id], places.item.id);
  }
});
