import { expect, test } from '@playwright/test';

test('点开某一天后，日期详情在视口中间，不贴底', async ({ page }) => {
  await page.goto('/schedule/calendar?view=month');
  const today = new Date();
  await page
    .getByRole('button', { name: new RegExp(`^${today.getMonth() + 1}月${today.getDate()}日`) })
    .first()
    .click();

  const dialog = page.locator('[data-dialog-place="center"]');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(viewport).toBeTruthy();
  const top = box!.y;
  const bottom = viewport!.height - (box!.y + box!.height);
  expect(top).toBeGreaterThan(16);
  expect(bottom).toBeGreaterThan(16);
});
