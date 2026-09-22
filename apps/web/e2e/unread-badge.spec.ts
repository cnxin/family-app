import { expect, test } from '@playwright/test';
import { apiClient, isoDate, stamp } from './helpers';

test('有未读时导航角标出现，全部已读后消失', async ({ page, request, isMobile }) => {
  const dad = apiClient(request);
  await dad.patch('/notifications/read-all', {});
  const dish = await dad.post<{ id: string; name: string }>('/dishes', {
    name: stamp('角标菜'),
    category: '素菜',
  });
  try {
    const menu = await dad.get<{ id: string }>(`/menus?date=${isoDate(2)}&mealType=lunch`);
    const withItem = await dad.post<{ items: { id: string; dish: { id: string } }[] }>(
      `/menus/${menu.id}/items`,
      { items: [{ dishId: dish.id }] },
    );
    const item = withItem.items.find((one) => one.dish.id === dish.id);
    expect(item).toBeTruthy();
    await apiClient(request, '妈妈').patch(`/menu-items/${item!.id}`, {
      status: 'rejected',
      reason: 'e2e 角标',
    });

    await page.goto('/');
    if (isMobile) {
      const nav = page.getByRole('navigation', { name: '主导航' });
      await expect(nav.locator('[data-unread-dot]')).toBeVisible();
      await nav.getByRole('button', { name: '日程', exact: true }).dispatchEvent('pointerdown');
      await expect(page.getByRole('menu', { name: '日程的功能' }).locator('[data-unread-badge]')).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: '功能导航' }).locator('[data-unread-badge]')).toBeVisible();
    }

    await page.goto('/schedule/notifications');
    await page.getByRole('button', { name: '全部已读', exact: true }).click();
    const shell = isMobile
      ? page.getByRole('navigation', { name: '主导航' }).locator('[data-unread-dot]')
      : page.getByRole('navigation', { name: '功能导航' }).locator('[data-unread-badge]');
    await expect(shell).toHaveCount(0);
  } finally {
    await dad.delete(`/dishes/${dish.id}`);
    await dad.patch('/notifications/read-all', {}).catch(() => undefined);
  }
});
