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

    const dragHandle = page.getByTestId('adaptive-dialog-drag-handle');
    await expectTouchTarget(dragHandle, '弹层拖动区域');
    await expect(dragHandle).toHaveCSS('cursor', 'grab');
    const handleBox = await dragHandle.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();

    const pointerX = (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2;
    const pointerY = (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2;
    const initialY = dialogBox?.y ?? 0;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX, pointerY + 84, { steps: 6 });
    const draggedDownY = (await dialog.boundingBox())?.y ?? 0;
    expect(draggedDownY - initialY).toBeGreaterThan(60);

    await page.mouse.move(pointerX, pointerY + 28, { steps: 4 });
    const reversedY = (await dialog.boundingBox())?.y ?? 0;
    expect(draggedDownY - reversedY).toBeGreaterThan(35);
    await page.mouse.up();
    await expect.poll(async () => {
      const settledBox = await dialog.boundingBox();
      return Math.abs((settledBox?.y ?? 0) - initialY);
    }).toBeLessThanOrEqual(4);

    const settledHandleBox = await dragHandle.boundingBox();
    const dismissX = (settledHandleBox?.x ?? 0) + (settledHandleBox?.width ?? 0) / 2;
    const dismissY = (settledHandleBox?.y ?? 0) + (settledHandleBox?.height ?? 0) / 2;
    await page.mouse.move(dismissX, dismissY);
    await page.mouse.down();
    await page.mouse.move(dismissX, dismissY + 240, { steps: 4 });
    await page.mouse.up();
    await expect(dialog).not.toBeVisible();
    return;
  } else {
    const settledBox = await dialog.boundingBox();
    expect(settledBox).not.toBeNull();
    expect(settledBox?.y ?? 0).toBeGreaterThan(80);
    expect((settledBox?.y ?? 0) + (settledBox?.height ?? 0)).toBeLessThan((viewport?.height ?? 0) - 80);
    await expect(page.getByTestId('adaptive-dialog-drag-handle')).toHaveCount(0);
  }

  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('投票表单适配视口且核心操作支持鼠标和触控', async ({ page }, testInfo) => {
  await openAuthenticatedHome(page);
  await page.goto('/polls');

  const createButton = page.getByRole('button', { name: '发起投票', exact: true });
  await expectTouchTarget(createButton, '发起投票按钮');
  await expect(createButton).toHaveCSS('cursor', 'pointer');
  await createButton.focus();
  await expect(createButton).toHaveCSS('outline-style', 'solid');
  await expect(page.getByRole('heading', { name: '家庭投票', exact: true })).toHaveCSS(
    'font-size',
    testInfo.project.name === 'mobile-chrome' ? '26px' : '32px',
  );
  await createButton.click();

  const dialog = page.getByTestId('poll-form-dialog');
  await expect(dialog).toBeVisible();
  await expectTouchTarget(dialog.getByRole('button', { name: '关闭', exact: true }), '关闭投票表单');
  await expectTouchTarget(dialog.getByRole('button', { name: '家庭', exact: true }), '家庭分类');
  await expectTouchTarget(dialog.getByRole('button', { name: '采购', exact: true }), '采购分类');
  await expectTouchTarget(dialog.getByRole('button', { name: '取消', exact: true }), '取消投票表单');
  await expectTouchTarget(dialog.getByRole('button', { name: '发起投票', exact: true }), '提交投票表单');

  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect.poll(async () => {
      const settledBox = await dialog.boundingBox();
      if (!settledBox || !viewport) return Number.POSITIVE_INFINITY;
      return Math.abs(settledBox.y + settledBox.height - viewport.height);
    }).toBeLessThanOrEqual(4);
  } else {
    expect(box?.y ?? 0).toBeGreaterThan(40);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan((viewport?.height ?? 0) - 40);
  }

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('知识库筛选、弹层和未保存保护支持鼠标和触控', async ({ page }, testInfo) => {
  await openAuthenticatedHome(page);
  await page.goto('/knowledge');

  const createArticleButton = page.getByRole('button', { name: '新建知识文章', exact: true });
  await expectTouchTarget(createArticleButton, '新建知识文章');
  await expect(createArticleButton).toHaveCSS('cursor', 'pointer');
  await createArticleButton.focus();
  await expect(createArticleButton).toHaveCSS('outline-style', 'solid');
  for (const label of ['全部', '家庭流程', '设备说明', '常用联系', '居家资料', '其他']) {
    await expectTouchTarget(page.getByRole('button', { name: label, exact: true }), `${label}筛选`);
  }
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: '新建知识文章', exact: true }).click();
  const editor = page.getByTestId('knowledge-editor-dialog');
  await expect(editor).toBeVisible();
  await expectTouchTarget(editor.getByRole('button', { name: '关闭', exact: true }), '关闭知识编辑器');
  await expectTouchTarget(editor.getByRole('button', { name: '创建文章', exact: true }), '创建文章');

  const viewport = page.viewportSize();
  const box = await editor.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect.poll(async () => {
      const settledBox = await editor.boundingBox();
      if (!settledBox || !viewport) return Number.POSITIVE_INFINITY;
      return Math.abs(settledBox.y + settledBox.height - viewport.height);
    }).toBeLessThanOrEqual(4);
  } else {
    expect(box?.y ?? 0).toBeGreaterThan(40);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan((viewport?.height ?? 0) - 40);
  }

  await editor.getByLabel('标题', { exact: true }).fill('未保存的知识文章');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('放弃未保存的修改？', { exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '放弃编辑', exact: true }), '放弃编辑');
  await page.getByRole('button', { name: '放弃编辑', exact: true }).click();
  await expect(editor).not.toBeVisible();

  const articleTitle = `知识库 UI 回归-${testInfo.project.name}-${Date.now()}`;
  await page.getByRole('button', { name: '新建知识文章', exact: true }).click();
  await editor.getByLabel('标题', { exact: true }).fill(articleTitle);
  await editor.getByLabel('正文', { exact: true }).fill('用于检查详情、历史与固定操作栏。');
  await editor.getByRole('button', { name: '创建文章', exact: true }).click();

  const articleCard = page.getByRole('button', { name: `打开${articleTitle}`, exact: true });
  await expect(articleCard).toBeVisible();
  const detail = page.getByTestId('knowledge-detail-dialog');
  await expect(detail).toBeVisible();
  await expectTouchTarget(detail.getByRole('button', { name: '历史', exact: true }), '版本历史');
  await expectTouchTarget(detail.getByRole('button', { name: '编辑', exact: true }), '编辑文章');
  await expectTouchTarget(detail.getByRole('button', { name: '归档', exact: true }), '归档文章');
  await detail.getByRole('button', { name: '历史', exact: true }).click();
  await expect(detail.getByText('版本历史', { exact: true })).toBeVisible();
  await expectTouchTarget(detail.getByRole('button', { name: '返回文章详情', exact: true }), '返回文章详情');
});

test('知识库在中等宽度使用扩展工具栏且不产生横向溢出', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome');
  await page.setViewportSize({ width: 820, height: 900 });
  await openAuthenticatedHome(page);
  await page.goto('/knowledge');

  const searchBox = page.getByLabel('搜索家庭知识库').locator('xpath=..');
  const statusFilter = page.getByRole('button', { name: '使用中', exact: true }).locator('xpath=..');
  await expect(searchBox).toBeVisible();
  await expect(statusFilter).toBeVisible();
  const searchBoxBounds = await searchBox.boundingBox();
  const statusFilterBounds = await statusFilter.boundingBox();
  expect(searchBoxBounds).not.toBeNull();
  expect(statusFilterBounds).not.toBeNull();
  expect(Math.abs((searchBoxBounds?.y ?? 0) - (statusFilterBounds?.y ?? 0))).toBeLessThanOrEqual(2);
  await expect(page.getByRole('heading', { name: '家庭知识库', exact: true })).toHaveCSS(
    'font-size',
    '32px',
  );
  await expectNoHorizontalOverflow(page);
});
