import { expect, test } from '@playwright/test';

test('对话框的关闭按钮触控区不小于 44px，点了就关', async ({ page }) => {
  await page.goto('/schedule/polls?create=1');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  const box = await close.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(dialog).toBeHidden();
});
