import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectTouchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} 应该可见`).not.toBeNull();
  expect(box?.width ?? 0, `${label} 宽度应不小于 44px`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${label} 高度应不小于 44px`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(dimensions.rootClientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

test('普通成员默认进入温和的移动首页并可用鼠标操作核心入口', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/');

  await expect(page.getByTestId('consumer-home')).toBeVisible();
  await expect(page.getByText('今日家庭工作台', { exact: true })).toBeVisible();
  await expect(page.getByText('需要我处理', { exact: true })).toBeVisible();
  await expect(page.getByText('常用功能', { exact: true })).toBeVisible();
  await expect(page.getByText('本周概览', { exact: true })).toHaveCount(0);
  const moreDisclosure = page.getByTestId('consumer-more-disclosure');
  await expectTouchTarget(moreDisclosure, '更多家庭内容');
  await moreDisclosure.click();
  await expect(page.getByText('本周概览', { exact: true })).toBeVisible();
  await expect(page.getByText('最近回忆', { exact: true })).toBeVisible();
  await expect(page.getByText('其他功能', { exact: true })).toBeVisible();
  await expect(page.getByText('家庭工作台', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('admin-desktop-sidebar')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  for (const name of ['今天', '吃饭', '安排', '消息', '我的']) {
    const tab = page.getByRole('tab', {
      name: name === '消息' ? /消息/ : name,
      exact: name !== '消息',
    });
    await expect(tab).toBeVisible();
    await expectTouchTarget(tab, `${name}标签`);
  }

  const quickAdd = page.getByTestId('consumer-quick-add-button');
  await expectTouchTarget(quickAdd, '快捷新增按钮');
  await quickAdd.click();
  const quickDialog = page.getByTestId('quick-add-dialog');
  await expect(quickDialog).toBeVisible();
  await expect(quickDialog.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  for (const target of ['quick-add-task', 'quick-add-shopping', 'quick-add-reminder', 'quick-add-order', 'quick-add-poll']) {
    await expectTouchTarget(quickDialog.getByTestId(target), target);
  }
  await quickDialog.getByTestId('quick-add-task').click();
  await expect(page).toHaveURL(/\/tasks\?create=1/);
  const quickTaskDialog = page.getByTestId('task-form-dialog');
  await expect(quickTaskDialog).toBeVisible();
  await quickTaskDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await expect(page.getByTestId('consumer-home')).toBeVisible();

  await page.getByRole('tab', { name: /消息/ }).click();
  const familyInbox = page.getByTestId('consumer-family-inbox');
  await expect(familyInbox).toBeVisible();
  await expect(familyInbox.getByText('家庭收件箱', { exact: true })).toBeVisible();
  const actionInboxTab = familyInbox.getByRole('button', { name: /需要处理/ });
  const updateInboxTab = familyInbox.getByRole('button', { name: /仅供了解/ });
  await expectTouchTarget(actionInboxTab, '需要处理标签');
  await expectTouchTarget(updateInboxTab, '仅供了解标签');
  await updateInboxTab.click();
  await expect(familyInbox.getByText('家庭动态', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await expect(page.getByTestId('consumer-home')).toBeVisible();

  const assistantLink = page.getByTestId('consumer-quick-assistant');
  await expectTouchTarget(assistantLink, '问问小管家入口');
  await assistantLink.click();
  await expect(page).toHaveURL(/\/assistant$/);
  const assistantInput = page.getByTestId('agent-message-input');
  const assistantSend = page.getByTestId('agent-send-button');
  await expectTouchTarget(assistantSend, '小管家发送按钮');
  await page.getByTestId('agent-new-conversation').click();
  await assistantInput.fill('今天三餐吃什么？');
  await expect(assistantInput).toHaveValue('今天三餐吃什么？');
  await assistantSend.click();
  await expect(page.getByText(/今天|早餐|午餐|晚餐/).last()).toBeVisible({ timeout: 60_000 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await expect(page.getByTestId('consumer-home')).toBeVisible();

  const memoriesLink = page.getByRole('link', { name: '全部回忆', exact: true });
  await expectTouchTarget(memoriesLink, '全部回忆入口');
  await memoriesLink.click();
  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByRole('heading', { name: '家庭回忆', exact: true })).toBeVisible();
  const createMemory = page.getByRole('button', { name: '新建家庭回忆', exact: true });
  await expectTouchTarget(createMemory, '记录家庭回忆按钮');
  await createMemory.click();
  const memoryDialog = page.getByTestId('memory-form-dialog');
  await expect(memoryDialog).toBeVisible();
  await expect(memoryDialog.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  await memoryDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(memoryDialog).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await expect(page.getByTestId('consumer-home')).toBeVisible();

  const pollLink = page.getByTestId('consumer-quick-polls');
  await expectTouchTarget(pollLink, '家庭投票入口');
  await expect(pollLink).toHaveCSS('cursor', 'pointer');
  await pollLink.click();
  await expect(page).toHaveURL(/\/polls$/);

  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await expect(page.getByTestId('consumer-home')).toBeVisible();
  const taskLink = page.getByRole('link', { name: /家庭任务/ }).first();
  await expectTouchTarget(taskLink, '家庭任务入口');
  await taskLink.click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId('consumer-tasks-header')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('consumer-tasks.png'), fullPage: true });

  const addTask = page.getByRole('button', { name: '添加任务', exact: true });
  await expectTouchTarget(addTask, '添加任务按钮');
  await addTask.click();
  const taskDialog = page.getByTestId('task-form-dialog');
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  await taskDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(taskDialog).not.toBeVisible();

  await page.getByRole('tab', { name: '吃饭', exact: true }).click();
  await expect(page).toHaveURL(/\/canteen$/);
  await expect(page.getByTestId('consumer-canteen-header')).toBeVisible();
  await expectTouchTarget(
    page.getByRole('link', { name: '开始点菜', exact: true }),
    '开始点菜按钮',
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('consumer-canteen.png'), fullPage: true });

  await page.getByRole('tab', { name: '安排', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByTestId('consumer-calendar-header')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('consumer-calendar.png'), fullPage: true });

  const addEvent = page.getByRole('button', { name: '添加事件', exact: true });
  await expectTouchTarget(addEvent, '添加事件按钮');
  await addEvent.click();
  const eventDialog = page.getByTestId('calendar-event-dialog');
  await expect(eventDialog).toBeVisible();
  await expect(eventDialog.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  await eventDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(eventDialog).not.toBeVisible();

  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByTestId('consumer-profile-header')).toBeVisible();
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0);
  const securityDisclosure = page.getByTestId('consumer-security-disclosure');
  await expectTouchTarget(securityDisclosure, '账号安全设置');
  await page.screenshot({ path: testInfo.outputPath('consumer-profile.png'), fullPage: true });
  await securityDisclosure.click();
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开我的积分', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('consumer-home-mobile.png'),
    fullPage: true,
  });

  const viewports = [
    { name: 'small-phone', width: 375, height: 667 },
    { name: 'landscape', width: 844, height: 390 },
    { name: 'wide-member', width: 1280, height: 800 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByTestId('consumer-home')).toBeVisible();
    await expect(page.getByTestId('admin-desktop-sidebar')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '吃饭', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`consumer-home-${viewport.name}.png`),
      fullPage: true,
    });
  }
});
