import { expect, test, type Locator, type Page } from '@playwright/test';

async function openAuthenticated(
  page: Page,
  path: string,
  projectName: string,
) {
  await page.goto(path);
  if (/\/login\/?$/.test(new URL(page.url()).pathname)) {
    const password = process.env.E2E_ACCOUNT_PASSWORD;
    expect(
      password,
      '隔离浏览器测试必须提供 E2E_ACCOUNT_PASSWORD；空字符串表示无密码账号',
    ).not.toBeUndefined();
    await page
      .getByPlaceholder('输入账号')
      .fill(process.env.E2E_LOGIN_NAME ?? '爸爸');
    await page.getByPlaceholder('输入密码').fill(password ?? '');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname));
    await page.goto(path);
  }
  await page.context().storageState({
    path:
      projectName === 'desktop-chrome'
        ? 'e2e/.auth/desktop.json'
        : 'e2e/.auth/mobile.json',
  });
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
  expect(widths.body).toBeLessThanOrEqual(1);
  expect(widths.root).toBeLessThanOrEqual(1);
}

test('管理员可从空账本完成首次建账、预算、记账和撤销', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  test.setTimeout(90_000);
  await openAuthenticated(page, '/finance', testInfo.project.name);

  await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
  await expect(page.getByText('还没有财务账户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '账户', exact: true }).click();

  const createAccount = page.getByRole('button', { name: '新增账户', exact: true });
  await expectTouchTarget(createAccount, '新增账户按钮');
  await createAccount.click();
  await page.getByLabel('账户名称', { exact: true }).fill('家庭日常账户');
  await page.getByLabel('初始余额', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(page.getByText('家庭日常账户', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '预算', exact: true }).click();
  await page.getByRole('button', { name: '设置餐饮预算', exact: true }).click();
  await page.getByLabel('预算金额', { exact: true }).fill('500');
  await page.getByRole('button', { name: '保存预算', exact: true }).click();
  await expect(page.getByText('¥500.00', { exact: true })).toBeVisible();

  const record = page.getByRole('button', { name: '记一笔', exact: true });
  await expectTouchTarget(record, '记一笔按钮');
  await record.click();
  await page.getByLabel('金额', { exact: true }).fill('88.80');
  await page.getByLabel('账目名称', { exact: true }).fill('周末家庭聚餐');
  await page.getByRole('button', { name: '确认记账', exact: true }).click();

  await page.getByRole('button', { name: '流水', exact: true }).click();
  await expect(page.getByText('周末家庭聚餐', { exact: true })).toBeVisible();
  const reverse = page.getByRole('button', { name: '撤销周末家庭聚餐', exact: true });
  await expectTouchTarget(reverse, '撤销流水按钮');
  await reverse.click();
  await page.getByRole('button', { name: '确认撤销', exact: true }).click();
  await expect(page.getByText('已由反向流水撤销', { exact: true })).toBeVisible();
  await expect(page.getByText(/cannot contain a nested/)).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('finance-workflow-mobile.png'),
  });
});

test('家庭财务在移动和桌面视口无横向溢出且弹层可操作', async ({ page }, testInfo) => {
  await openAuthenticated(page, '/finance', testInfo.project.name);
  await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '问小管家', exact: true }), '问小管家按钮');
  await expectTouchTarget(page.getByRole('button', { name: '上个月', exact: true }), '上个月按钮');
  await expectTouchTarget(page.getByRole('button', { name: '概览', exact: true }), '概览分段按钮');
  await expectNoHorizontalOverflow(page);

  const record = page.getByRole('button', { name: '记一笔', exact: true });
  await expect(record).toBeEnabled();
  await record.click();
  await expect(page.getByText('确认后写入不可变家庭流水，误记可由管理员撤销', { exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '关闭', exact: true }).last(), '关闭记账弹层按钮');
  await expectTouchTarget(page.getByRole('button', { name: '确认记账', exact: true }), '确认记账按钮');
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(500);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`finance-dialog-${testInfo.project.name}.png`),
  });
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
});

test('家庭财务适配 375 像素小屏、横屏、深色和减少动态效果', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  for (const viewport of [
    { name: 'small', width: 375, height: 812 },
    { name: 'landscape', width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openAuthenticated(page, '/finance', testInfo.project.name);
    await expect(page.getByRole('heading', { name: '家庭财务', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`finance-${viewport.name}-dark-reduced-motion.png`),
    });
  }
});
