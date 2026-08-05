import { expect, test, type Page, type Route } from '@playwright/test';

const account = {
  id: 'account-consumer-workbench-fixture',
  loginName: 'consumer-workbench-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: 'member-consumer-workbench-fixture',
  householdId: 'household-consumer-workbench-fixture',
  name: '妈妈',
  avatarEmoji: 'M',
  role: 'member',
  prefersCooking: false,
};
const today = new Date().toISOString().slice(0, 10);

async function json(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: 'application/json',
    status: 200,
  });
}

async function installFixtureSession(page: Page) {
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'consumer-workbench-token');
      window.localStorage.setItem('family-app-refresh-token', 'consumer-workbench-refresh-token');
      window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
      window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, (route) => json(route, {
    accessToken: 'consumer-workbench-token-refreshed',
    refreshToken: 'consumer-workbench-refresh-token-refreshed',
    account,
    member,
  }));
}

async function installHomeRoutes(page: Page) {
  const task = {
    id: `task:fixture:${today}`,
    taskId: 'task-fixture',
    dueDate: today,
    status: 'pending',
    assigneeId: member.id,
    assignee: member,
    resolvedById: null,
    resolvedBy: null,
    resolvedAt: null,
    canManageTask: false,
    canUpdate: true,
    pointsAwarded: false,
    task: {
      id: 'task-fixture',
      title: '整理客厅',
      note: '晚饭前一起收好桌面',
      startsOn: today,
      recurrence: 'once',
      repeatInterval: 1,
      endsOn: null,
      createdById: 'member-dad-fixture',
      createdBy: { ...member, id: 'member-dad-fixture', name: '爸爸' },
      defaultAssigneeId: member.id,
      defaultAssignee: member,
      rewardPoints: 0,
      isArchived: false,
      createdAt: `${today}T08:00:00.000Z`,
      updatedAt: `${today}T08:00:00.000Z`,
    },
  };
  const poll = {
    id: 'poll-fixture',
    title: '周末去哪里散步',
    description: '选一个大家都方便的地方',
    category: 'activity',
    voteMode: 'single',
    maxChoices: 1,
    closesAt: null,
    status: 'open',
    sourceModule: null,
    sourceId: null,
    createdById: 'member-dad-fixture',
    createdBy: { ...member, id: 'member-dad-fixture', name: '爸爸' },
    closedById: null,
    closedBy: null,
    closedAt: null,
    createdAt: `${today}T08:00:00.000Z`,
    updatedAt: `${today}T08:00:00.000Z`,
    canManage: false,
    canVote: true,
    totalVoters: 0,
    totalVotes: 0,
    selectedOptionIds: [],
    options: [
      { id: 'poll-option-1', label: '滨江公园', description: null, mediaId: null, sortOrder: 0, voteCount: 0, percentage: 0, voters: [], media: null },
      { id: 'poll-option-2', label: '社区绿道', description: null, mediaId: null, sortOrder: 1, voteCount: 0, percentage: 0, voters: [], media: null },
    ],
  };
  const notification = {
    id: 'notification-fixture',
    householdId: member.householdId,
    recipientId: member.id,
    recipient: member,
    module: 'calendar',
    type: 'calendar_updated',
    sourceId: null,
    title: '周六家庭聚餐时间已确定',
    body: '晚上六点在家吃饭',
    targetPath: '/calendar',
    readAt: null,
    createdAt: `${today}T09:00:00.000Z`,
  };

  await page.route(/\/menus\?date=/, (route) => json(route, []));
  await page.route(/\/shopping-list\?date=/, (route) => json(route, [{
    id: 'shopping-fixture',
    date: today,
    ingredientId: null,
    ingredient: null,
    customName: '牛奶',
    totalQty: '1',
    requiredQty: null,
    availableQty: null,
    unit: '盒',
    checked: false,
    source: 'manual',
    inventoryItemId: null,
    inventoryItem: null,
    maintenanceConsumableId: null,
    inventoryConfirmation: null,
  }]));
  await page.route(/\/tasks\?start=/, (route) => json(route, [task]));
  await page.route(/\/notifications(?:\?.*)?$/, (route) => json(route, [notification]));
  await page.route(/\/polls\?status=all$/, (route) => json(route, [poll]));
  await page.route(/\/media(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/reminders\?status=scheduled$/, (route) => json(route, []));
  await page.route(/\/visits\?status=scheduled$/, (route) => json(route, []));
  await page.route(/\/assets\?status=active$/, (route) => json(route, []));
  await page.route(/\/points\/accounts$/, (route) => json(route, []));
  await page.route(/\/knowledge-articles(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/travel-plans(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/memories(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/activities(?:\?.*)?$/, (route) => json(route, [{
    id: 'activity-fixture',
    module: 'task',
    action: 'task_completed',
    summary: '爸爸完成了倒垃圾',
    detail: null,
    actor: { id: 'member-dad-fixture', name: '爸爸', avatarEmoji: 'D' },
    subjectMemberId: null,
    targetPath: '/tasks',
    metadata: {},
    occurredAt: `${today}T10:00:00.000Z`,
  }]));
  await page.route(/\/agent\/status$/, (route) => json(route, {
    enabled: true,
    selected: { kind: 'fake', name: '本地摘要', available: true },
  }));
  await page.route(/\/members$/, (route) => json(route, [member]));
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await installFixtureSession(page);
  await installHomeRoutes(page);
});

test('今日工作台、家庭收件箱和快捷新增在移动 Web 可完整操作', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('consumer-home')).toBeVisible();
  await expect(page.getByText('今日家庭工作台', { exact: true })).toBeVisible();
  await expect(page.getByText('整理客厅', { exact: true })).toBeVisible();
  await expect(page.getByText('周末去哪里散步', { exact: true })).toBeVisible();
  await expect(page.getByText('爸爸完成了倒垃圾', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const quickAdd = page.getByTestId('consumer-quick-add-button');
  const quickAddBox = await quickAdd.boundingBox();
  expect(quickAddBox?.width).toBeGreaterThanOrEqual(44);
  expect(quickAddBox?.height).toBeGreaterThanOrEqual(44);
  await quickAdd.click();
  const quickDialog = page.getByTestId('quick-add-dialog');
  await expect(quickDialog).toBeVisible();
  const dragHandle = quickDialog.getByTestId('adaptive-dialog-drag-handle');
  await expect(dragHandle).toBeVisible();
  await expect(quickDialog.getByRole('button', { name: '关闭', exact: true })).toBeVisible();
  for (const id of ['quick-add-task', 'quick-add-shopping', 'quick-add-reminder', 'quick-add-order', 'quick-add-poll']) {
    const box = await quickDialog.getByTestId(id).boundingBox();
    expect(box?.height, id).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('quick-add-sheet-mobile.png'), fullPage: true });
  const handleBox = await dragHandle.boundingBox();
  if (!handleBox) throw new Error('快捷新增拖动把手不可见');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 320, { steps: 8 });
  await page.mouse.up();
  await expect(quickDialog).not.toBeVisible();
  await quickAdd.click();
  await expect(quickDialog).toBeVisible();
  await quickDialog.getByTestId('quick-add-task').click();
  await expect(page).toHaveURL(/\/tasks\?create=1/);
  await expect(page.getByTestId('task-form-dialog')).toBeVisible();
  await page.getByTestId('task-form-dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await page.getByRole('tab', { name: /消息/ }).click();
  const inbox = page.getByTestId('consumer-family-inbox');
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText('家庭收件箱', { exact: true })).toBeVisible();
  await expect(inbox.getByText('整理客厅', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: /仅供了解/ }).click();
  await expect(inbox.getByText('周六家庭聚餐时间已确定', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('family-inbox-mobile.png'), fullPage: true });

  await page.getByRole('tab', { name: '今天', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.getByTestId('consumer-home')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('today-workbench-dark-reduced-motion.png'), fullPage: true });
});

test('今日工作台在 375 像素小屏和横屏没有溢出或底栏遮挡', async ({ page }) => {
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByTestId('consumer-home')).toBeVisible();
    await expect(page.getByText('全部功能', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const lastFeature = page.getByTestId('consumer-quick-memories');
    await lastFeature.scrollIntoViewIfNeeded();
    await expect(lastFeature).toBeVisible();
    const featureBox = await lastFeature.boundingBox();
    const tabBox = await page.getByRole('tab', { name: '今天', exact: true }).boundingBox();
    expect(featureBox?.y ?? 0).toBeLessThan(tabBox?.y ?? viewport.height);
  }
});
