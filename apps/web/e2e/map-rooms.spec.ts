import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiClient, stamp, watchPageErrors } from './helpers';

// 地图编辑器 v2 第 4 笔：在编辑器里拆分 / 合并房间（docs/ui-prototypes/map-editor-v2.md §2.3、§2.4）。
// 只在电脑上；不进撤销栈，确认框写清后果（拍板 2）；合并后东西全改记到目标（拍板 3）。

interface Location { id: string; name: string; parentId: string | null; archivedAt: string | null; itemCount: number; mapShape: { points: [number, number][] } | null }

const box = (x1: number, y1: number, x2: number, y2: number) => ({ type: 'polygon', points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });

test('拆分：从墙到墙拖一条线，确认框写清哪个柜子跟过去；合并：点挨着的房间，东西改记过去、被并的归档', async ({ page, request, isMobile }) => {
  test.skip(isMobile, '拆分 / 合并只在电脑上（v2 拍板 1）');
  const errors = watchPageErrors(page);
  const tag = randomUUID().slice(0, 4);
  const admin = apiClient(request);
  await admin.put('/map', { viewBox: { w: 1000, h: 1000 }, clearShapes: true });
  const living = await admin.post<Location>('/locations', { name: `客厅${tag}` });
  const bedroom = await admin.post<Location>('/locations', { name: `卧室${tag}` });
  await admin.patch(`/locations/${living.id}/shape`, { mapShape: box(80, 80, 620, 480) });
  await admin.patch(`/locations/${bedroom.id}/shape`, { mapShape: box(80, 480, 620, 900) });
  const tv = await admin.post<Location>('/locations', { parentId: living.id, name: '电视柜', kind: 'container' });
  await admin.patch(`/locations/${tv.id}/shape`, { mapShape: { type: 'rect', x: 500, y: 380, w: 100, h: 60 } });
  const item = await admin.post<{ id: string }>('/inventory-items', {
    name: stamp('床单'), category: '其他', quantity: 2, unit: '套', lowStockThreshold: 0, restockQuantity: 2, defaultLocationId: bedroom.id,
  });
  const all = async () => admin.get<Location[]>('/locations?includeArchived=true');
  const created: string[] = [];
  try {
    await page.goto('/house/map?edit=1');
    const editor = page.locator('[data-map-editor]');
    const livingPath = editor.locator(`[data-map-room="${living.id}"]`);
    await expect(livingPath).toBeVisible();
    const floating = page.locator('[data-map-floating]');

    // 拆分：选中客厅 → 更多 → 拆分 → 在 x = 400 从上墙外拖到下墙外
    await livingPath.click();
    await floating.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /拆分/ }).click();
    await expect(page.getByRole('status')).toContainText('从一面墙拖到另一面墙');
    const room = (await livingPath.boundingBox())!;
    const x = room.x + ((400 - 80) / 540) * room.width;
    await page.mouse.move(x, room.y - 6);
    await page.mouse.down();
    await page.mouse.move(x + 2, room.y + room.height + 4, { steps: 8 });
    await expect(editor.locator('[data-map-split-line]')).toBeAttached();
    await page.mouse.up();
    const dialog = page.getByRole('dialog', { name: `把「客厅${tag}」拆成两间` });
    await expect(dialog).toContainText('1 个柜子（电视柜）按位置归到新房间');
    await expect(dialog).toContainText('拆分后不能撤销');
    await expect(editor.locator('[data-map-ghost]')).toBeAttached();
    await dialog.getByLabel('新房间名字').fill(`餐厅${tag}`);
    await dialog.getByRole('button', { name: '拆分' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await all()).find((one) => one.name === `餐厅${tag}`)?.id).toBeTruthy();
    const dining = (await all()).find((one) => one.name === `餐厅${tag}`)!;
    created.push(dining.id);
    const after = await all();
    expect(after.find((one) => one.id === tv.id)!.parentId).toBe(dining.id);
    // 线在 x ≈ 400（鼠标换算有一两个单位的误差），客厅留左边大块
    const cut = Math.max(...after.find((one) => one.id === living.id)!.mapShape!.points.map(([px]) => px));
    expect(Math.abs(cut - 400)).toBeLessThanOrEqual(10);

    // 合并：选中卧室 → 更多 → 合并到… → 挨着的客厅、餐厅都高亮 → 点客厅 → 确认
    await editor.locator(`[data-map-room="${bedroom.id}"]`).click();
    await floating.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /合并到/ }).click();
    await expect(editor.locator(`[data-map-room="${living.id}"][data-hit="true"]`)).toHaveCount(1);
    await expect(editor.locator(`[data-map-room="${dining.id}"][data-hit="true"]`)).toHaveCount(1);
    await livingPath.click();
    const confirm = page.getByRole('dialog', { name: `把「卧室${tag}」并进「客厅${tag}」？` });
    await expect(confirm).toContainText(`1 件东西将改记到「客厅${tag}」`);
    await expect(confirm).toContainText('合并后不能撤销');
    await confirm.getByRole('button', { name: '合并' }).click();
    await expect.poll(async () => Boolean((await all()).find((one) => one.id === bedroom.id)!.archivedAt)).toBe(true);
    const merged = (await all()).find((one) => one.id === living.id)!;
    expect(merged.itemCount).toBe(1);
    expect(Math.max(...merged.mapShape!.points.map(([, py]) => py))).toBeGreaterThanOrEqual(890);
    await expect(editor.locator(`[data-map-room="${bedroom.id}"]`)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await admin.delete(`/inventory-items/${item.id}`).catch(() => undefined);
    for (const id of [living.id, bedroom.id, ...created]) await admin.post(`/locations/${id}/archive`, {}).catch(() => undefined);
  }
});
