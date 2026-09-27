import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { addDays, householdToday } from '@family/shared';
import { apiClient, stamp } from './helpers';

const label = (date: string) =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`),
  );

test('资产详情的维护记录显示实际完成日，补记昨天就是昨天', async ({ page, request }) => {
  const api = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const yesterday = addDays(today, -1);
  const asset = await api.post<{ id: string }>('/assets', { name: stamp('补记设备'), category: 'appliance' });
  try {
    const planTitle = stamp('补记计划');
    const plan = await api.post<{ id: string }>(`/assets/${asset.id}/maintenance-plans`, {
      title: planTitle,
      frequencyDays: 30,
      nextDueDate: today,
    });
    await api.post(`/maintenance-plans/${plan.id}/complete`, {
      performedOn: yesterday,
      consumeInventory: false,
      idempotencyKey: `record-date-${randomUUID()}`,
    });
    await page.goto(`/house/assets/${asset.id}`);
    // 维护记录那一行：标题是计划名，下一行是「完成日 · 谁 · 下次 …」
    const record = page.locator('p', { hasText: planTitle }).filter({ hasNotText: '下次' }).last().locator('xpath=..');
    await expect(record).toContainText(`${label(yesterday)} ·`);
    await expect(record).not.toContainText(`${label(today)} ·`);
  } finally {
    await api.patch(`/assets/${asset.id}`, { status: 'retired' });
  }
});
