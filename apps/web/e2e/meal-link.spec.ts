import { expect, test } from '@playwright/test';

test('从午餐卡进入点菜页，当前餐次是午餐', async ({ page }) => {
  await page.goto('/');
  const lunch = page.getByRole('link', { name: /午餐/ });
  await expect(lunch).toHaveAttribute('href', /\/eat\/order\?date=\d{4}-\d{2}-\d{2}&meal=lunch$/);
  await lunch.click();
  await expect(page).toHaveURL(/\/eat\/order$/);
  await expect(page.getByRole('button', { name: '午餐', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
