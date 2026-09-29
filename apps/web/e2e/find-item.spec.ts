import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiClient, stamp, watchPageErrors } from './helpers';

// I3 找东西（docs/item-location-plan.md §3 I3）：⌘K 输物品名，结果带「上次放在 …」，回车跳地图对准并高亮；
// 资产详情、库存编辑里「在地图上看」。

interface Location { id: string; pathLabel: string }

async function openSearch(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: '快速跳转', exact: true }).click();
  else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const input = page.getByRole('dialog', { name: '快速跳转' }).getByRole('textbox');
  await expect(input).toBeVisible();
  return input;
}

test('⌘K 搜东西带「上次放在」→ 回车跳地图对准并高亮；详情里「在地图上看」', async ({ page, request, isMobile }) => {
  const errors = watchPageErrors(page);
  const admin = apiClient(request);
  const tag = randomUUID().slice(0, 4);
  await admin.put('/map', { viewBox: { w: 1000, h: 1000 }, clearShapes: true });
  const study = await admin.post<Location>('/locations', { name: `书房${tag}` });
  const shelf = await admin.post<Location>('/locations', { parentId: study.id, name: '书柜', kind: 'container' });
  const top = await admin.post<Location>('/locations', { parentId: shelf.id, name: '顶层' });
  await admin.patch(`/locations/${study.id}/shape`, { mapShape: { type: 'polygon', points: [[100, 100], [700, 100], [700, 700], [100, 700]] } });
  await admin.patch(`/locations/${shelf.id}/shape`, { mapShape: { type: 'rect', x: 150, y: 150, w: 200, h: 80 } });
  const name = stamp('护照袋');
  const asset = await admin.post<{ id: string }>('/assets', { name, category: 'other' });
  await admin.patch(`/assets/${asset.id}/location`, { locationId: top.id });
  const itemName = stamp('备用灯泡');
  const item = await admin.post<{ id: string }>('/inventory-items', {
    name: itemName, category: '其他', quantity: 2, unit: '个', lowStockThreshold: 0, restockQuantity: 1, defaultLocationId: shelf.id,
  });
  try {
    await page.goto('/');
    const input = await openSearch(page, isMobile);
    await input.fill(name);
    const palette = page.getByRole('dialog', { name: '快速跳转' });
    const row = palette.getByRole('button', { name: new RegExp(name) });
    await expect(row).toContainText(`上次放在 ${top.pathLabel}`);
    await input.press('Enter');
    await expect(page).toHaveURL(/\/house\/map$/);
    await expect(page.locator(`[data-map-drawer="${shelf.id}"]`)).toContainText(name);
    await expect(page.locator(`[data-map-container="${shelf.id}"]`)).toHaveAttribute('data-hit', 'true');

    await page.goto(`/house/assets/${asset.id}`);
    await page.getByRole('link', { name: '在地图上看 ›' }).click();
    await expect(page.locator(`[data-map-drawer="${shelf.id}"]`)).toContainText(name);

    await page.goto('/house/inventory');
    await page.getByRole('button', { name: `编辑${itemName}` }).click();
    await page.getByRole('dialog').getByRole('link', { name: '在地图上看 ›' }).click();
    await expect(page.locator(`[data-map-drawer="${shelf.id}"]`)).toContainText(itemName);
    expect(errors).toEqual([]);
  } finally {
    await admin.delete(`/inventory-items/${item.id}`).catch(() => undefined);
    await admin.patch(`/assets/${asset.id}/location`, { locationId: null }).catch(() => undefined);
    await admin.post(`/locations/${study.id}/archive`, {}).catch(() => undefined);
  }
});
