import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_ISOLATED !== '1', '点菜列表只在隔离库验收');

async function expectCatalog(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: '点菜' })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '把红烧肉加进菜单' })).toBeVisible();
  await expect(page.getByRole('button', { name: '把拍黄瓜加进菜单' })).toBeVisible();
  await expect(page.getByText('家里还没有')).toHaveCount(0);

  await page.getByRole('button', { name: /素菜/ }).click();
  await expect(page.getByRole('button', { name: '把拍黄瓜加进菜单' })).toBeVisible();
  await expect(page.getByRole('button', { name: '把红烧肉加进菜单' })).toHaveCount(0);

  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.getByRole('button', { name: '把红烧肉加进菜单' })).toBeVisible();
}

test('从今天页三餐卡进入点菜页，全部里能看到已有菜品', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /早餐/ }).click();
  await expect(page).toHaveURL(/\/eat\/order$/);
  await expectCatalog(page);
});

test('直接进入点菜页，全部里能看到已有菜品', async ({ page }) => {
  await page.goto('/eat/order');
  await expectCatalog(page);
});
