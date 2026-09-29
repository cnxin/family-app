import { expect, test } from '@playwright/test';
import { householdToday } from '@family/shared';
import { apiClient, stamp } from './helpers';

// 深链约定 `task`：/schedule/tasks?task=<id> 滚到这件并高亮 2 秒，处理完抹掉参数（智能家居「晾衣服」留意卡用）。

test('任务页 ?task=<id>：滚到那件、高亮 2 秒后消退，参数从 URL 抹掉；没有这件也不报错', async ({ page, request }) => {
  const admin = apiClient(request);
  const today = householdToday('Asia/Shanghai');
  const title = stamp('深链任务');
  const task = await admin.post<{ id: string }>('/tasks', { title, startsOn: today });
  try {
    await page.goto(`/schedule/tasks?task=${task.id}`);
    const row = page.locator('[data-task-occurrence]').filter({ hasText: title });
    await expect(row).toHaveAttribute('data-highlighted', 'true');
    await expect(row).toBeInViewport();
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
    await expect(row).not.toHaveAttribute('data-highlighted', 'true', { timeout: 4_000 });

    await page.goto('/schedule/tasks?task=00000000-0000-4000-8000-00000000abcd');
    await expect(page).toHaveURL(/\/schedule\/tasks$/);
    await expect(page.locator('[data-highlighted]')).toHaveCount(0);
  } finally {
    await admin.patch(`/tasks/${task.id}`, { isArchived: true });
  }
});
