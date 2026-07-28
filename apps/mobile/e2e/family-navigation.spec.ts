import { expect, test, type Page } from '@playwright/test';

const API_URL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';

const NAVIGATION = {
  home: { mobile: '首页', desktop: '家庭首页', path: '/' },
  order: { mobile: '点菜', desktop: '点菜', path: '/order' },
  kitchen: { mobile: '菜单', desktop: '菜单安排', path: '/kitchen' },
  shopping: { mobile: '采购', desktop: '采购与库存', path: '/shopping' },
  profile: { mobile: '我的', desktop: '我的', path: '/profile' },
} as const;

type NavigationKey = keyof typeof NAVIGATION;

async function openSection(
  page: Page,
  projectName: string,
  section: NavigationKey,
) {
  const target = NAVIGATION[section];
  const locator = projectName === 'mobile-chrome'
    ? page.getByRole('tab', { name: target.mobile, exact: true })
    : page.getByRole('link', { name: target.desktop, exact: true });

  await expect(locator).toBeVisible();
  await locator.click();
  await expect(page).toHaveURL(
    target.path === '/' ? /\/$/ : new RegExp(`${target.path}$`),
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(
    dimensions.rootClientWidth,
  );
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(
    dimensions.bodyClientWidth,
  );
}

test('家庭成员可浏览核心页面且布局不横向溢出', async (
  { page, request },
  testInfo,
) => {
  const runtimeErrors: string[] = [];
  let simulatingUnauthorized = false;
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (
      simulatingUnauthorized &&
      message.text().includes('status of 401')
    ) {
      return;
    }
    runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  let forcedUnauthorized = 0;
  let refreshRequests = 0;
  let rejectedAuthorization: string | undefined;
  simulatingUnauthorized = true;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/refresh') {
      refreshRequests += 1;
    }
  });
  await page.route(/\/(dishes|menus|shopping-list)(\?|$)/, async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization;
    if (!rejectedAuthorization) rejectedAuthorization = authorization;
    if (
      request.method() === 'GET' &&
      authorization === rejectedAuthorization &&
      forcedUnauthorized < 2
    ) {
      forcedUnauthorized += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: '测试访问令牌失效' },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.reload();
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();
  expect(forcedUnauthorized).toBe(2);
  expect(refreshRequests).toBe(1);
  await page.waitForLoadState('networkidle');
  simulatingUnauthorized = false;
  expect(runtimeErrors).toEqual([]);

  await openSection(page, testInfo.project.name, 'kitchen');
  await expect(page.getByText('菜单安排', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('本餐主厨', { exact: true })).toHaveCount(3);
  const historyButtons = page.getByRole('button', { name: /操作记录/ });
  await expect(historyButtons).toHaveCount(3);
  await historyButtons.first().click();
  await expect(
    page
      .getByText('暂无记录', { exact: true })
      .or(page.getByText(/点了「/).first()),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'order');
  await expect(page.getByText('点菜', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('搜索菜名')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'shopping');
  await expect(
    page.getByText('采购与库存', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '家庭库存', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增库存' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'profile');
  await expect(page.getByText('家庭偏好', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();
  expect(runtimeErrors).toEqual([]);

  const accessToken = await page.evaluate(() =>
    window.localStorage.getItem('family-app-token'),
  );
  expect(accessToken).toBeTruthy();
  const logout = await request.post(`${API_URL}/auth/logout`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(logout.ok()).toBeTruthy();
});
