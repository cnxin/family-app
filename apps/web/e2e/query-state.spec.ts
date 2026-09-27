import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_ISOLATED !== '1', '失败态只在隔离库验收');

function fail(status = 500) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'INTERNAL', message: '暂时失败' } }),
  };
}

test('今天页留意区 500 不画成空态', async ({ page }) => {
  await page.route('**/api/today/attention**', (route) => route.fulfill(fail()));
  await page.goto('/');
  const section = page.locator('[data-today-attention]');
  await expect(section.getByText('没加载出来')).toBeVisible();
  await expect(section.getByRole('button', { name: '再试一次' })).toBeVisible();
  await expect(page.getByText('一切安好')).toHaveCount(0);
  await expect(page.getByText('今天没有需要留意')).toHaveCount(0);
});

test('家里页模块 500 仍放出功能，不画成空态', async ({ page }) => {
  await page.route('**/api/system/modules**', (route) => route.fulfill(fail()));
  await page.goto('/home');
  await expect(page.getByText('没刷新出来')).toBeVisible();
  await expect(page.getByText('从下面挑一个，家里的功能会随着使用慢慢长出来。')).toHaveCount(0);
  await expect(page.locator('[data-home-grid] a').first()).toBeVisible();
});

test('购物清单 500 不画成空清单', async ({ page }) => {
  await page.route('**/api/shopping-list**', (route) => route.fulfill(fail()));
  await page.goto('/house/shopping');
  await expect(page.getByRole('heading', { name: '购物清单' })).toBeVisible();
  await expect(page.getByText('没加载出来')).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次' })).toBeVisible();
  await expect(page.getByText('清单是空的')).toHaveCount(0);
});
