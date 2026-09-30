import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiClient, watchPageErrors } from './helpers';

// 地图编辑器 v2 第 3 笔：家具库（docs/ui-prototypes/map-editor-v2.md §3）。
// 收纳类落成带图标的柜子（进树、自动编号、不叠着放），装饰类整列存在地图上（不起名、看模式不可点）；
// 转 90° 记朝向，放 / 转都能撤销；「换成别的家具…」换类型、自动起的名字跟着换。电脑和手机都能摆（拍板 1）。

interface Location { id: string; name: string; parentId: string | null; icon: string | null; mapShape: { type: string; x: number; y: number; w: number; h: number } | null }
interface Decoration { id: string; kind: string; roomId: string | null; x: number; y: number; w: number; h: number; rotation?: number }

async function setupRoom(request: APIRequestContext, tag: string) {
  const admin = apiClient(request);
  await admin.put('/map', { viewBox: { w: 1000, h: 1000 }, clearShapes: true });
  const living = await admin.post<Location>('/locations', { name: `客厅${tag}` });
  await admin.patch(`/locations/${living.id}/shape`, { mapShape: { type: 'polygon', points: [[80, 80], [620, 80], [620, 480], [80, 480]] } });
  return living;
}

/** 电脑上家具库面板一直开着；手机上 sheet 放一个就收起，要再点「家具」 */
async function pick(page: Page, key: string, isMobile: boolean) {
  const button = page.locator(`[data-furniture-pick="${key}"]`);
  if (!(await button.isVisible())) await page.getByRole('toolbar', { name: '编辑工具' }).getByRole('button', { name: isMobile ? '家具' : '家具库', exact: true }).click();
  await button.click();
}

test('家具库：放收纳（自动编号、不叠着）、放装饰、转向、撤销、换家具，看模式装饰不可点', async ({ page, request, isMobile }) => {
  const errors = watchPageErrors(page);
  const tag = randomUUID().slice(0, 4);
  const living = await setupRoom(request, tag);
  const admin = apiClient(request);
  const children = async () => (await admin.get<Location[]>('/locations')).filter((one) => one.parentId === living.id);
  const decorations = async () => (await admin.get<{ decorations: Decoration[] }>('/map')).decorations;
  try {
    await page.goto('/house/map?edit=1');
    const editor = page.locator('[data-map-editor]');
    const room = editor.locator(`[data-map-room="${living.id}"]`);
    await expect(room).toBeVisible();
    await room.click();

    // 收纳：衣柜按默认 160 × 60 落在房间里，带图标；再放一个叫「衣柜 2」，不压第一个
    await pick(page, 'wardrobe', isMobile);
    await expect.poll(async () => (await children()).find((one) => one.name === '衣柜')?.mapShape?.w).toBe(160);
    const first = (await children()).find((one) => one.name === '衣柜')!;
    expect(first.icon).toBe('wardrobe');
    await expect(editor.locator(`[data-map-container="${first.id}"][data-furniture="wardrobe"]`)).toBeVisible();
    await pick(page, 'wardrobe', isMobile);
    await expect.poll(async () => (await children()).find((one) => one.name === '衣柜 2')?.mapShape).not.toBeFalsy();
    const [a, b] = ['衣柜', '衣柜 2'].map((name) => children().then((list) => list.find((one) => one.name === name)!.mapShape!));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.x + ra.w <= rb.x || rb.x + rb.w <= ra.x || ra.y + ra.h <= rb.y || rb.y + rb.h <= ra.y, '第二个衣柜不压第一个').toBe(true);

    // 装饰：沙发 200 × 85 存在地图上，只显示类型、没有「改名」
    await pick(page, 'sofa', isMobile);
    await expect.poll(async () => (await decorations()).length).toBe(1);
    const [sofa] = await decorations();
    expect(sofa).toMatchObject({ kind: 'sofa', roomId: living.id, w: 200, h: 85 });
    const floating = page.locator('[data-map-floating]');
    await expect(floating).toBeVisible();
    await expect(floating.getByRole('button', { name: '改名' })).toHaveCount(0);

    // 转 90°：宽高互换、记朝向；撤销两次：先回到没转，再把沙发拿掉
    await floating.getByRole('button', { name: '↻ 90°' }).click();
    await expect.poll(async () => (await decorations())[0]).toMatchObject({ w: 85, h: 200, rotation: 90 });
    const undo = page.getByRole('toolbar', { name: '编辑工具' }).getByRole('button', { name: '撤销' });
    await undo.click();
    await expect.poll(async () => (await decorations())[0]?.w).toBe(200);
    await undo.click();
    await expect.poll(async () => (await decorations()).length).toBe(0);
    // 再撤一步：衣柜 2（还没记东西）删掉
    await undo.click();
    await expect.poll(async () => (await children()).some((one) => one.name === '衣柜 2')).toBe(false);

    // 换成别的家具：衣柜 → 书柜，自动起的名字跟着换
    await editor.locator(`[data-map-container="${first.id}"]`).click();
    await floating.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /换成别的家具/ }).click();
    await expect(page.locator('[data-furniture-pick="sofa"]')).toHaveCount(0);
    await page.locator('[data-furniture-pick="bookcase"]').click();
    await expect.poll(async () => (await children()).find((one) => one.id === first.id)).toMatchObject({ icon: 'bookcase', name: '书柜' });

    // 看模式：再放一张床（装饰），完成后床画着但点不到，书柜照样能点
    await pick(page, 'bed', isMobile);
    await expect.poll(async () => (await decorations()).length).toBe(1);
    await page.getByRole('button', { name: '完成' }).click();
    await expect(editor).toHaveCount(0);
    const [bed] = await decorations();
    const view = page.locator('[data-map-canvas="view"]');
    await expect(view.locator(`[data-map-decor="${bed.id}"]`)).toBeAttached();
    await expect(view.locator(`[data-map-decor="${bed.id}"]`)).toHaveCSS('pointer-events', 'none');
    await expect(view.getByRole('button', { name: '书柜' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await admin.put('/map/decorations', { version: (await admin.get<{ decorationsVersion: number }>('/map')).decorationsVersion, items: [] }).catch(() => undefined);
    await admin.post(`/locations/${living.id}/archive`, {}).catch(() => undefined);
  }
});
