import { expect, test, type Page } from '@playwright/test';
import { apiClient, stamp } from './helpers';

function waitForPatch(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/tasks\/[^/]+\/instances\/\d{4}-\d{2}-\d{2}$/.test(new URL(response.url()).pathname),
  );
}

test('今天页待认领任务点认领后进入我的，刷新仍在', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('认领');
  let taskId: string | null = null;

  try {
    await page.goto('/schedule/tasks');
    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/tasks'),
    );
    await page.getByPlaceholder('加一件今天要做的事').fill(title);
    await page.getByRole('button', { name: '添加', exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    taskId = ((await createResponse.json()) as { data: { id: string } }).data.id;

    await page.goto('/');
    const familyRow = page.locator('[data-task-group="family"] [data-task-row]').filter({ hasText: title });
    await expect(familyRow.getByRole('button', { name: '认领' })).toBeVisible();
    const claimed = waitForPatch(page);
    await familyRow.getByRole('button', { name: '认领' }).click();
    expect((await claimed).ok()).toBeTruthy();

    const mineRow = page.locator('[data-task-group="mine"] [data-task-row]').filter({ hasText: title });
    await expect(mineRow.getByText('我的', { exact: true })).toBeVisible();
    await expect(mineRow.getByRole('button', { name: '认领' })).toHaveCount(0);

    await page.reload();
    await expect(mineRow.getByText('我的', { exact: true })).toBeVisible();
  } finally {
    if (taskId) await api.delete(`/tasks/${taskId}`);
  }
});
