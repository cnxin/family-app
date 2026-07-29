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
  test.setTimeout(60_000);
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
  const staleAccessRoute = /\/(dishes|menus|shopping-list)(\?|$)/;
  simulatingUnauthorized = true;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/refresh') {
      refreshRequests += 1;
      const body = request.postDataJSON() as { refreshToken?: string } | null;
      if (body?.refreshToken) presentedRefreshTokens.push(body.refreshToken);
    }
  });
  await page.route(staleAccessRoute, async (route) => {
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
  await page.unroute(staleAccessRoute);
  simulatingUnauthorized = false;
  expect(runtimeErrors).toEqual([]);

  const tasksLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link', { name: '查看任务', exact: true })
      : page.getByRole('link', { name: '家庭任务', exact: true });
  await expect(tasksLink).toBeVisible();
  await tasksLink.click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('家庭任务', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '添加任务', exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const taskTitle = `任务回归-${testInfo.project.name}`;
  await page.getByRole('button', { name: '添加任务', exact: true }).first().click();
  await expect(page.getByText('新建家庭任务', { exact: true })).toBeVisible();
  await page.getByLabel('任务名称').fill(taskTitle);
  await page.getByLabel('任务备注').fill('浏览器端新增任务');
  await page.getByRole('button', { name: '添加任务', exact: true }).last().click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await openSection(page, testInfo.project.name, 'calendar');
  const calendarTask = page.getByRole('button').filter({ hasText: taskTitle });
  await expect(calendarTask).toBeVisible();
  await calendarTask.click();
  await expect(page).toHaveURL(/\/tasks\?date=.*taskId=/);
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `编辑${taskTitle}` }).click();
  await page.getByLabel('任务备注').fill('浏览器端已编辑任务');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('浏览器端已编辑任务', { exact: true })).toBeVisible();

  await page.getByRole('checkbox', { name: `完成${taskTitle}` }).click();
  await page.getByRole('button', { name: '已处理', exact: true }).click();
  await expect(page.getByRole('button', { name: `恢复${taskTitle}` }).first()).toBeVisible();
  await page.getByRole('button', { name: `恢复${taskTitle}` }).first().click();
  await page.getByRole('button', { name: '待办', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `停用${taskTitle}` }).click();
  await expect(page.getByText('停用这个任务？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停用任务', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  const pollsLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link', { name: '查看投票', exact: true })
      : page.getByRole('link', { name: '家庭投票', exact: true });
  await expect(pollsLink).toBeVisible();
  await pollsLink.click();
  await expect(page).toHaveURL(/\/polls$/);
  await expect(page.getByText('家庭投票', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '发起投票', exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const pollTitle = `投票回归-${testInfo.project.name}`;
  await page.getByRole('button', { name: '发起投票', exact: true }).first().click();
  await expect(page.getByText('发起家庭投票', { exact: true })).toBeVisible();
  await page.getByLabel('投票标题').fill(pollTitle);
  await page.getByLabel('投票说明').fill('浏览器端新增投票');
  await page.getByRole('textbox', { name: '候选项1', exact: true }).fill('周六上午');
  await page.getByRole('textbox', { name: '候选项2', exact: true }).fill('周日下午');
  await page.getByRole('button', { name: '发起投票', exact: true }).last().click();
  await expect(page.getByRole('checkbox', { name: '选择周六上午' })).toBeVisible();

  await page.getByRole('checkbox', { name: '选择周六上午' }).click();
  await page.getByRole('button', { name: `提交${pollTitle}的投票` }).click();
  await expect(page.getByText(/1 票 · 100%/).first()).toBeVisible();

  await page.getByRole('button', { name: `编辑投票${pollTitle}` }).click();
  await expect(page.getByText('编辑家庭投票', { exact: true })).toBeVisible();
  await page.getByLabel('投票说明').fill('浏览器端已编辑投票');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('浏览器端已编辑投票', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `结束投票${pollTitle}` }).click();
  await expect(page.getByText('结束这个投票？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '结束投票', exact: true }).click();
  await page.getByRole('button', { name: '已结束', exact: true }).click();
  await expect(page.getByRole('button', { name: `重新开启投票${pollTitle}` })).toBeVisible();
  await page.getByRole('button', { name: `重新开启投票${pollTitle}` }).click();
  await page.getByRole('button', { name: '进行中', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '取消选择周六上午' })).toBeVisible();

  await page.getByRole('button', { name: `删除投票${pollTitle}` }).click();
  await expect(page.getByText('删除这个投票？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除投票', exact: true }).click();
  await expect(page.getByText(pollTitle, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

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

  const eventTitle = `日历回归-${testInfo.project.name}-${Date.now().toString(36)}`;
  await page.getByRole('button', { name: '添加事件', exact: true }).first().click();
  await expect(page.getByText('新建家庭事件', { exact: true })).toBeVisible();
  await page.getByLabel('事件名称').fill(eventTitle);
  await page.getByLabel('事件备注').fill('浏览器端新增事件');
  await page.getByRole('button', { name: '添加事件', exact: true }).last().click();
  await expect(page.getByRole('button', { name: `编辑${eventTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `编辑${eventTitle}` }).click();
  await page.getByLabel('事件备注').fill('浏览器端已编辑');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByLabel('事件备注')).not.toBeVisible();
  const eventRow = page
    .getByRole('button', { name: `提醒${eventTitle}` })
    .locator('..');
  await expect(eventRow.getByText('浏览器端已编辑', { exact: true })).toBeVisible();

  await eventRow.getByRole('button', { name: `提醒${eventTitle}` }).click();
  await expect(page).toHaveURL(/\/reminders\?sourceModule=calendar&sourceId=/);
  await expect(page.getByText('新建提醒', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: `选择${eventTitle}` }).click();
  await page.getByRole('button', { name: '明天', exact: true }).click();
  await page.getByLabel('提醒时间').fill('18:30');
  const remindDad = page.getByRole('checkbox', { name: '提醒爸爸', exact: true });
  const remindMom = page.getByRole('checkbox', { name: '提醒妈妈', exact: true });
  await expect(remindDad).toHaveAttribute('aria-checked', 'true');
  await remindMom.click();
  await expect(remindMom).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '设置提醒', exact: true }).click();
  await expect(page.getByLabel('提醒时间')).not.toBeVisible();
  const reminderCard = page
    .getByRole('button', { name: `编辑提醒${eventTitle}` })
    .locator('../../..');
  await expect(reminderCard.getByText(eventTitle, { exact: true })).toBeVisible();
  await expect(reminderCard.getByText('爸爸、妈妈', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await reminderCard.getByRole('button', { name: `编辑提醒${eventTitle}` }).click();
  await expect(page.getByText('编辑提醒', { exact: true })).toBeVisible();
  await page.getByLabel('提醒时间').fill('19:00');
  await page.getByRole('button', { name: '保存提醒', exact: true }).click();
  await expect(page.getByLabel('提醒时间')).not.toBeVisible();
  await expect(reminderCard.getByText(/19:00/)).toBeVisible();

  await page.getByRole('button', { name: `取消提醒${eventTitle}` }).click();
  await expect(page.getByText('取消这个提醒？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消提醒', exact: true }).last().click();
  await page.getByRole('button', { name: '已取消', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: eventTitle })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'calendar');

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

  await page.getByRole('button', { name: '打开家庭成员', exact: true }).click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByText('家庭成员', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '在家成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑爸爸', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑爸爸', exact: true }).click();
  await expect(page.getByText('编辑成员', { exact: true })).toBeVisible();
  await expect(page.getByLabel('成员名称', { exact: true })).toHaveValue('爸爸');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('编辑成员', { exact: true })).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
  } else {
    await openSection(page, testInfo.project.name, 'profile');
  }

  await page.getByRole('button', { name: '打开家庭活动', exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText('家庭活动', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByRole('tab')).toHaveCount(6);
  }
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  await expect(
    page.getByText('家庭今日概览', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /打开通知中心/ }).first().click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByText('通知中心', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '未读', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  await expect(page.getByText('家庭今日概览', { exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);

  const accessToken = await page.evaluate(() =>
    window.localStorage.getItem('family-app-token'),
  );
  expect(accessToken).toBeTruthy();
  await openSection(page, testInfo.project.name, 'profile');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByText(/退出账号「爸爸」/)).toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();
  const revoked = await request.get(`${API_URL}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(revoked.status()).toBe(401);
});
