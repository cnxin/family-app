import { expect, test, type Locator, type Page } from '@playwright/test';

async function openAuthenticatedHome(page: Page) {
  await page.goto('/');
  const homeTitle = page.getByText('今天需要关注', { exact: true });
  if (await homeTitle.isVisible()) return homeTitle;

  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();
  const password = process.env.E2E_ACCOUNT_PASSWORD;
  expect(password, '隔离浏览器测试必须提供临时账号密码').toBeTruthy();
  await page.getByPlaceholder('输入账号').fill(process.env.E2E_LOGIN_NAME ?? '爸爸');
  await page.getByPlaceholder('输入密码').fill(password ?? '');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(homeTitle).toBeVisible();
  return homeTitle;
}

async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 应有可测量尺寸`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(0);
  expect(widths.root).toBeLessThanOrEqual(0);
}

test('首页核心操作满足鼠标和触控尺寸要求', async ({ page }, testInfo) => {
  await openAuthenticatedHome(page);

  if (testInfo.project.name === 'mobile-chrome') {
    await expectTouchTarget(page.getByTestId('home-notification-button'), '通知按钮');
    await expectTouchTarget(
      page.getByRole('link').filter({ hasText: '家庭食堂' }).first(),
      '家庭食堂入口',
    );
    await expectTouchTarget(
      page.getByRole('link').filter({ hasText: '采购与库存' }).first(),
      '采购与库存入口',
    );
    await expectTouchTarget(page.getByRole('tab', { name: '首页', exact: true }), '首页标签');
  } else {
    await expectTouchTarget(page.getByTestId('desktop-notification-button'), '通知按钮');
    await expectTouchTarget(
      page.getByRole('link', { name: '家庭食堂', exact: true }),
      '家庭食堂侧栏入口',
    );
    await expectTouchTarget(
      page.getByRole('link', { name: '采购与库存', exact: true }),
      '采购与库存侧栏入口',
    );
    await expect(page.getByText('功能模块', { exact: true })).toHaveCount(0);
  }

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('home-light.png'),
  });
});

test('深色模式和减少动态效果保持清晰反馈', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const title = await openAuthenticatedHome(page);
  await expect(title).toHaveCSS('color', 'rgb(244, 247, 244)');

  const button = testInfo.project.name === 'mobile-chrome'
    ? page.getByTestId('home-notification-button')
    : page.getByTestId('desktop-notification-button');
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const transformBefore = await button.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const transformPressed = await button.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  expect(transformPressed).toBe(transformBefore);
  await expect(title).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('home-dark-reduced-motion.png'),
  });
});

test('桌面侧栏分组可用鼠标展开并保持当前模块可见', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome');
  await openAuthenticatedHome(page);

  const householdGroup = page.getByTestId('desktop-nav-group-household');
  await expectTouchTarget(householdGroup, '家庭管理分组');
  await expect(householdGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: '家庭任务', exact: true })).toHaveCount(0);

  await householdGroup.click();
  await expect(householdGroup).toHaveAttribute('aria-expanded', 'true');
  const tasksLink = page.getByRole('link', { name: '家庭任务', exact: true });
  await expectTouchTarget(tasksLink, '家庭任务侧栏入口');
  await tasksLink.click();

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(householdGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(householdGroup).toBeDisabled();
  await expect(tasksLink).toBeVisible();
});

test('日期选择在移动端贴底、桌面居中且核心操作不少于 44px', async ({ page }, testInfo) => {
  await openAuthenticatedHome(page);
  await page.goto('/shopping');

  const trigger = page.getByLabel(/^打开日期选择/).first();
  await expectTouchTarget(trigger, '日期选择入口');
  await trigger.click();

  const dialog = page.getByTestId('date-selector-dialog');
  await expect(dialog).toBeVisible();
  await expectTouchTarget(dialog.getByRole('button', { name: '下个月' }), '下个月按钮');
  await expectTouchTarget(dialog.getByRole('button', { name: '关闭', exact: true }), '关闭日期按钮');
  await expectTouchTarget(dialog.getByRole('button', { name: /^选择/ }).first(), '日期按钮');

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect.poll(async () => {
      const settledBox = await dialog.boundingBox();
      if (!settledBox || !viewport) return Number.POSITIVE_INFINITY;
      return Math.abs(settledBox.y + settledBox.height - viewport.height);
    }).toBeLessThanOrEqual(4);
  } else {
    const settledBox = await dialog.boundingBox();
    expect(settledBox).not.toBeNull();
    expect(settledBox?.y ?? 0).toBeGreaterThan(80);
    expect((settledBox?.y ?? 0) + (settledBox?.height ?? 0)).toBeLessThan((viewport?.height ?? 0) - 80);
  }

  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
