import { expect, test, type Page } from '@playwright/test';

const API_URL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';

const NAVIGATION = {
  home: { mobile: '首页', desktop: '家庭首页', path: '/' },
  order: { mobile: '点菜', desktop: '点菜', path: '/order' },
  kitchen: { mobile: '菜单', desktop: '菜单安排', path: '/kitchen' },
  calendar: { mobile: '日历', desktop: '家庭日历', path: '/calendar' },
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
  const presentedRefreshTokens: string[] = [];
  let rejectedAuthorization: string | undefined;
  simulatingUnauthorized = true;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/refresh') {
      refreshRequests += 1;
      const body = request.postDataJSON() as { refreshToken?: string } | null;
      if (body?.refreshToken) presentedRefreshTokens.push(body.refreshToken);
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
  expect(forcedUnauthorized).toBeGreaterThanOrEqual(1);
  expect(forcedUnauthorized).toBeLessThanOrEqual(2);
  expect(refreshRequests).toBeGreaterThanOrEqual(1);
  expect(refreshRequests).toBeLessThanOrEqual(2);
  expect(new Set(presentedRefreshTokens).size).toBe(
    presentedRefreshTokens.length,
  );
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
      .or(
        page
          .getByText(
            /点了「|交给|取消了「|更新了「|将本餐主厨设为|清除了本餐主厨|结束并锁定了本餐|认领了「|开始制作「|标记为上桌|恢复了「|划掉了「/,
          )
          .first(),
      ),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'order');
  await expect(page.getByText('点菜', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('搜索菜名')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const recipesLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link', { name: '菜谱', exact: true })
      : page.getByRole('link', { name: '家庭菜谱', exact: true });
  await expect(recipesLink).toBeVisible();
  await recipesLink.click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByText('家庭菜谱', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('搜索菜名、做法或成员')).toBeVisible();
  await expect(page.getByRole('button', { name: '按菜品', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '按成员', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const firstRecipe = page
    .getByRole('link')
    .filter({ hasText: /种做法/ })
    .first();
  await expect(firstRecipe).toBeVisible();
  await firstRecipe.click();
  await expect(page.getByText(/做法版本（\d+）/)).toBeVisible();
  await expect(page.getByText('谁会做', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加我的做法' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'shopping');
  await expect(
    page.getByText('采购与库存', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '家庭库存', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增库存' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'calendar');
  await expect(page.getByText('家庭日历', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '添加事件', exact: true }).first()).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByRole('tab')).toHaveCount(6);
  }
  await expectNoHorizontalOverflow(page);

  const eventTitle = `日历回归-${testInfo.project.name}`;
  await page.getByRole('button', { name: '添加事件', exact: true }).first().click();
  await expect(page.getByText('新建家庭事件', { exact: true })).toBeVisible();
  await page.getByLabel('事件名称').fill(eventTitle);
  await page.getByLabel('事件备注').fill('浏览器端新增事件');
  await page.getByRole('button', { name: '添加事件', exact: true }).last().click();
  await expect(page.getByRole('button', { name: `编辑${eventTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `编辑${eventTitle}` }).click();
  await page.getByLabel('事件备注').fill('浏览器端已编辑');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('浏览器端已编辑', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `删除${eventTitle}` }).click();
  await expect(page.getByText('删除这个事件？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除事件', exact: true }).click();
  await expect(page.getByRole('button', { name: `编辑${eventTitle}` })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'profile');
  await expect(page.getByText('家庭偏好', { exact: true })).toBeVisible();
  await expect(page.getByText('账号安全', { exact: true })).toBeVisible();
  await expect(page.getByText('成员邀请', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更新密码' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '生成 48 小时邀请' }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: '愿意参与掌勺', exact: true }),
  ).toBeVisible();
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
