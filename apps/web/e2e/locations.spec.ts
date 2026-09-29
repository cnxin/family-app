import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, expectNoHorizontalOverflow, stamp, watchPageErrors } from './helpers';

// I1 位置字典（docs/item-location-plan.md §3 I1）：购物入库时选「放哪儿」→ 库存「按位置」能看到 → 行内一跳改位置；
// 管理页的树与内容；⌘K「记一下东西放哪」；位置管理页四张截图。

interface Location { id: string; pathLabel: string }

async function tree(request: APIRequestContext, tag: string) {
  const admin = apiClient(request);
  const kitchen = await admin.post<Location>('/locations', { name: `厨房${tag}` });
  const cabinet = await admin.post<Location>('/locations', { parentId: kitchen.id, name: '吊柜', kind: 'container' });
  const shelf = await admin.post<Location>('/locations', { parentId: cabinet.id, name: '左' });
  const storeroom = await admin.post<Location>('/locations', { name: `储物间${tag}` });
  return { kitchen, cabinet, shelf, storeroom };
}

/** 位置有引用只能归档：测完把这几个房间归档，免得别的用例的选择器里越来越长 */
async function archiveAll(request: APIRequestContext, ids: string[]) {
  const admin = apiClient(request);
  for (const id of ids) await admin.post(`/locations/${id}/archive`, {}).catch(() => undefined);
}

test.describe('设备日期与家庭日期不同', () => {
  // 浏览器放在檀香山：一天里有 18 小时它的日期比上海早一天，和 CI（UTC）在上海过零点后跑是同一种情况
  test.use({ timezoneId: 'Pacific/Honolulu' });
test('购物入库选「放哪儿」→ 库存按位置分组能看到 → 行内一跳改位置', async ({ page, request }) => {
  const admin = apiClient(request);
  const tag = randomUUID().slice(0, 4);
  const places = await tree(request, tag);
  const name = stamp('酱油');
  const item = await admin.post<{ id: string }>('/inventory-items', {
    name, category: '调料', quantity: 0, unit: '瓶', lowStockThreshold: 0, restockQuantity: 1,
  });
  // 购物页的「今天」按设备日期（timezone-audit T3 后置），也不读 ?date=：购物项按浏览器自己的日期建，
  // 否则 CI（UTC）在上海过了零点、UTC 还没过零点的那 8 小时里，页面上找不到这一项
  const today = await page.evaluate(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
  const bought = await admin.post<{ id: string }>('/shopping-items', { date: today, customName: name, totalQty: 2, unit: '瓶' });
  await admin.patch(`/shopping-items/${bought.id}`, { checked: true });
  try {
    await page.goto('/house/shopping');
    // 最里面那个同时含名字和「入库」按钮的 div 就是这一行（祖先在 DOM 顺序里排在前面）
    const row = page.locator('div').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: '入库', exact: true }) }).last();
    await row.getByRole('button', { name: '入库', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `确认「${name}」入库` });
    await dialog.getByRole('button', { name: new RegExp(name) }).click();
    await dialog.getByRole('button', { name: /放哪儿：选个位置/ }).click();
    const picker = page.getByRole('dialog', { name: '放哪儿？' });
    await picker.getByRole('button', { name: new RegExp(`^厨房${tag}`) }).click();
    await picker.getByRole('button', { name: /^吊柜/ }).click();
    await picker.getByRole('button', { name: /^左/ }).click();
    await expect(picker).toBeHidden();
    await expect(dialog.getByRole('button', { name: `放哪儿：${places.shelf.pathLabel}` })).toBeVisible();
    await dialog.getByRole('button', { name: '确认入库' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/house/inventory');
    await page.getByRole('tablist', { name: '分组方式' }).getByRole('tab', { name: '按位置' }).click();
    const group = page.locator(`[data-inventory-group="${places.shelf.pathLabel}"]`);
    await expect(group.locator(`[data-inventory-row="${item.id}"]`)).toBeVisible();

    // 行内改：点「上次放在 …」→ 选择器 → 储物间，行挪到储物间那一组
    await group.getByRole('button', { name: `改${name}的位置，上次放在${places.shelf.pathLabel}` }).click();
    const move = page.getByRole('dialog', { name: `${name}放哪儿？` });
    await expect(move.locator(`[data-location-option="${places.shelf.id}"]`)).toHaveAttribute('aria-current', 'true');
    await move.getByRole('button', { name: '全部' }).click();
    await move.getByRole('button', { name: new RegExp(`^储物间${tag}`) }).click();
    await expect(page.locator(`[data-inventory-group="${places.storeroom.pathLabel}"] [data-inventory-row="${item.id}"]`)).toBeVisible();
    await expect(group.locator(`[data-inventory-row="${item.id}"]`)).toHaveCount(0);
  } finally {
    await admin.patch(`/inventory-items/${item.id}`, { defaultLocationId: null });
    await admin.delete(`/shopping-items/${bought.id}`).catch(() => undefined);
    await archiveAll(request, [places.kitchen.id, places.storeroom.id]);
  }
});

});

test('⌘K「记一下东西放哪」：先挑位置，再挑库存里的东西', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', '链路在桌面项目验一次');
  const admin = apiClient(request);
  const tag = randomUUID().slice(0, 4);
  const places = await tree(request, tag);
  const name = stamp('手电筒');
  const item = await admin.post<{ id: string }>('/inventory-items', {
    name, category: '日用品', quantity: 1, unit: '个', lowStockThreshold: 0, restockQuantity: 1,
  });
  try {
    await page.goto('/house/inventory');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: '快速跳转' });
    await palette.getByRole('textbox').fill('记一下');
    await palette.getByRole('button', { name: /记一下东西放哪/ }).click();
    const picker = page.getByRole('dialog', { name: '东西放在哪儿？' });
    await picker.getByRole('button', { name: new RegExp(`^储物间${tag}`) }).click();
    const what = page.getByRole('dialog', { name: `放在「${places.storeroom.pathLabel}」的是哪样东西？` });
    await what.getByLabel('东西的名字').fill(name);
    await what.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('alert').filter({ hasText: `记下了：${name}上次放在 ${places.storeroom.pathLabel}` })).toBeVisible();
    await expect(page).toHaveURL(/\/house\/inventory$/);
  } finally {
    await admin.patch(`/inventory-items/${item.id}`, { defaultLocationId: null });
    await admin.delete(`/inventory-items/${item.id}`).catch(() => undefined);
    await archiveAll(request, [places.kitchen.id, places.storeroom.id]);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`位置管理页：树、点开看内容（${theme}，截图）`, async ({ page, request, isMobile }) => {
    const errors = watchPageErrors(page);
    const admin = apiClient(request);
    const tag = randomUUID().slice(0, 4);
    const places = await tree(request, tag);
    await admin.post('/locations', { parentId: places.kitchen.id, name: '台面' });
    const item = await admin.post<{ id: string }>('/inventory-items', {
      name: stamp('大米'), category: '主食', quantity: 5, unit: '斤', lowStockThreshold: 1, restockQuantity: 5,
      defaultLocationId: places.cabinet.id,
    });
    try {
      await page.addInitScript((mode) => localStorage.setItem('family-app.theme', mode), theme);
      // I2 起位置管理页并进 /house/map（左树右图，手机「清单」里是树）；老路径还能打开
      await page.goto('/house/locations');
      await expect(page).toHaveURL(/\/house\/map$/);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (isMobile) await page.getByRole('tab', { name: '清单' }).click();
      const node = page.locator(`[data-location-node="${places.cabinet.id}"]`);
      await expect(node).toContainText('吊柜');
      await expect(node).toContainText('1 样');
      await expect(page.locator(`[data-location-node="${places.shelf.id}"]`)).toHaveAttribute('data-depth', '3');
      await node.locator('button[aria-pressed]').click();
      // 有地图时桌面在地图抽屉里看，没有时在树下面看
      await expect(
        page.locator(`[data-location-contents="${places.cabinet.id}"], [data-map-drawer="${places.cabinet.id}"]`),
      ).toContainText('大米');
      await page.evaluate(() => document.fonts.ready);
      await expectNoHorizontalOverflow(page);
      const dir = resolve(process.cwd(), '../../.tmp-shots');
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `i1-locations-${isMobile ? '390x844' : '1280x800'}-${theme}.png`), animations: 'disabled' });
      expect(errors).toEqual([]);
    } finally {
      await admin.patch(`/inventory-items/${item.id}`, { defaultLocationId: null });
      await admin.delete(`/inventory-items/${item.id}`).catch(() => undefined);
      await archiveAll(request, [places.kitchen.id, places.storeroom.id]);
    }
  });
}
