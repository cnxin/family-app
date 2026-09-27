import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { addDays, householdToday } from '@family/shared';
import { apiClient, stamp } from './helpers';

test('库存：登记一个 3 天后到期的食品批次，出现在「批次与保质期」里', async ({ page, request }) => {
  const api = apiClient(request);
  const name = stamp('批次食品');
  // 临期天数按家庭日期算；CI 机器是 UTC，按机器日期会在上海凌晨差一天
  const expiresOn = addDays(householdToday('Asia/Shanghai'), 3);
  const item = await api.post<{ id: string }>('/inventory-items', {
    name,
    category: '其他',
    // 批次是从「未分批」的余量里划出来的（后端不会因为登记批次再加库存），所以先备 2 盒
    quantity: 2,
    unit: '盒',
    lowStockThreshold: 0,
    restockQuantity: 1,
  });

  try {
    await page.goto('/house/inventory');
    await page.getByRole('button', { name: '登记批次', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '登记食品批次' });
    await dialog.getByLabel('选择库存项').selectOption(item.id);
    await dialog.getByLabel('这一批的数量').fill('2');
    await dialog.getByLabel('到期日期（选填）').fill(expiresOn);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/inventory-batches'),
    );
    await dialog.getByRole('button', { name: '登记并入库' }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const batch = ((await response.json()) as { data: { inventoryItemId: string; expiresOn: string; status: string } })
      .data;
    expect(batch).toMatchObject({ inventoryItemId: item.id, expiresOn, status: 'expiring' });
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: '批次已登记' })).toBeVisible();

    await expect(page.getByText('批次与保质期', { exact: true })).toBeVisible();
    // 只按名字定位：到货日默认值仍按设备日期取（timezone-audit T3 未修），不在这里写死
    const row = page.getByRole('button', { name: new RegExp(`^${name} 2 盒`) });
    await expect(row).toContainText('3 天后到期');
  } finally {
    // 有批次的库存项后端不让删（留着流水审计）。先清零把批次消耗掉，让它退出批次列表和到期统计；
    // 再补 1 盒未分批的，免得余量 0 ≤ 阈值 0 被算进「待补货」，影响别的用例
    await api.patch(`/inventory-items/${item.id}`, { quantity: 0, idempotencyKey: `e2e-${randomUUID()}` });
    await api.patch(`/inventory-items/${item.id}`, { quantity: 1, idempotencyKey: `e2e-${randomUUID()}` });
  }
  const left = await api.get<{ inventoryItemId: string; quantity: string }[]>('/inventory-batches?status=all&days=7');
  expect(left.filter((one) => one.inventoryItemId === item.id && Number(one.quantity) > 0)).toEqual([]);
});
