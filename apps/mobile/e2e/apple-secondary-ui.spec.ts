import { expect, test, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);
const apiUrl = process.env.FAMILY_API_URL ?? 'http://localhost:3100';
const accessToken = 'secondary-ui-access-token-0123456789';
const refreshToken = 'secondary-ui-refresh-token-0123456789';
const account = { id: 'account-secondary-ui', loginName: 'secondary-ui', requiresPasswordSetup: false };
const member = {
  avatarEmoji: '家',
  householdId: 'household-secondary-ui',
  id: 'member-secondary-ui',
  name: '家庭管理员',
  prefersCooking: true,
  role: 'owner',
};
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAU1eY5sAAAAASUVORK5CYII=';

function dateOffset(days: number) {
  const value = new Date(`${today}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function json(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: 'application/json',
    status: 200,
  });
}

async function installFixture(page: Page) {
  const task = (
    id: string,
    title: string,
    status: 'pending' | 'done',
    assignee: typeof member | null = member,
  ) => ({
    assignee,
    assigneeId: assignee?.id ?? null,
    canManageTask: true,
    canUpdate: true,
    dueDate: today,
    id: `${id}:${today}`,
    pointsAwarded: false,
    resolvedAt: status === 'done' ? `${today}T10:00:00.000Z` : null,
    resolvedBy: status === 'done' ? member : null,
    resolvedById: status === 'done' ? member.id : null,
    status,
    task: {
      createdAt: `${today}T08:00:00.000Z`,
      createdBy: member,
      createdById: member.id,
      defaultAssignee: assignee,
      defaultAssigneeId: assignee?.id ?? null,
      endsOn: null,
      id,
      isArchived: false,
      note: status === 'done' ? '晚饭前已经完成' : '晚饭前一起整理好公共区域',
      recurrence: 'once',
      repeatInterval: 1,
      rewardPoints: 10,
      startsOn: today,
      title,
      updatedAt: `${today}T08:00:00.000Z`,
    },
    taskId: id,
  });
  const tasks = [
    task('task-living-room', '整理客厅', 'pending'),
    task('task-plants', '给绿植浇水', 'pending', null),
    task('task-bin', '倒垃圾', 'done'),
  ];
  const shopping = [
    { checked: false, customName: '牛奶', id: 'shopping-milk', ingredient: null, source: 'manual', totalQty: '2', unit: '盒' },
    { checked: false, customName: '垃圾袋', id: 'shopping-bag', ingredient: null, source: 'manual', totalQty: '1', unit: '包' },
    { checked: true, customName: '番茄', id: 'shopping-tomato', ingredient: null, source: 'manual', totalQty: '4', unit: '个' },
  ];
  const inventory = [
    ['inventory-rice', '大米', '主食', '8', '2', '斤'],
    ['inventory-oil', '食用油', '调料', '0.5', '1', '瓶'],
    ['inventory-medicine', '感冒药', '药品', '1', '1', '盒'],
  ].map(([id, name, category, quantity, lowStockThreshold, unit]) => ({
    batchSummary: { activeBatchCount: 0, earliestExpiresOn: null, expiredCount: 0, expiringCount: 0, trackedQuantity: 0, untrackedQuantity: Number(quantity) },
    category,
    id,
    ingredient: null,
    ingredientId: null,
    lowStockThreshold,
    name,
    quantity,
    restockQuantity: '1',
    unit,
    updatedAt: `${today}T08:00:00.000Z`,
  }));
  const calendar = [
    { date: today, endsAt: null, id: 'calendar-task', metadata: { assigneeName: member.name }, module: 'task', sourceId: 'task-living-room', startsAt: null, status: 'pending', summary: '晚饭前一起整理', targetPath: '/tasks', title: '整理客厅' },
    { date: today, endsAt: null, id: 'calendar-menu', metadata: { itemCount: 3, mealType: 'dinner' }, module: 'menu', sourceId: 'menu-dinner', startsAt: `${today}T18:30:00.000Z`, status: 'open', summary: '3 道菜', targetPath: '/kitchen', title: '晚餐已安排' },
    { date: today, endsAt: `${today}T21:00:00.000Z`, id: 'calendar-event', metadata: { canManage: true, createdByName: member.name }, module: 'calendar', sourceId: 'event-walk', startsAt: `${today}T20:00:00.000Z`, status: 'scheduled', summary: '沿河绿道走一圈', targetPath: '/calendar', title: '晚饭后散步' },
  ];
  const guest = { anonymizedAt: null, avatarEmoji: '姨', createdAt: `${today}T08:00:00.000Z`, id: 'guest-aunt', isActive: true, name: '小姨', note: '喜欢清淡口味', updatedAt: `${today}T08:00:00.000Z` };
  const visits = [{
    createdAt: `${today}T08:00:00.000Z`,
    endsAt: `${dateOffset(2)}T20:30:00.000Z`,
    guestWifiProfile: null,
    guests: [{ guest, id: 'visit-guest-aunt', invitation: null, isAttending: null, respondedAt: null }],
    hostMember: member,
    id: 'visit-weekend',
    mealRequests: [],
    note: '准备一顿轻松的家庭晚餐',
    startsAt: `${dateOffset(2)}T18:00:00.000Z`,
    status: 'scheduled',
    title: '周末家庭晚餐',
    updatedAt: `${today}T08:00:00.000Z`,
  }];
  const memories = [
    { archivedAt: null, canEdit: true, category: 'daily', createdAt: `${today}T08:00:00.000Z`, createdBy: member, happenedOn: today, id: 'memory-breakfast', photos: [{ caption: '阳台上的早餐', contentUrl: photo, createdAt: `${today}T08:00:00.000Z`, createdBy: member, id: 'photo-breakfast', mimeType: 'image/png', sizeBytes: 80 }], source: null, story: '今天的阳光很好，大家难得一起慢慢吃完早餐。', tags: ['早餐', '日常'], title: '阳台早餐', updatedAt: `${today}T08:00:00.000Z`, updatedBy: member, version: 1 },
    { archivedAt: null, canEdit: true, category: 'travel', createdAt: `${today}T08:00:00.000Z`, createdBy: member, happenedOn: dateOffset(-7), id: 'memory-park', photos: [{ caption: '公园散步', contentUrl: photo, createdAt: `${today}T08:00:00.000Z`, createdBy: member, id: 'photo-park', mimeType: 'image/png', sizeBytes: 80 }], source: null, story: '上周末的公园散步。', tags: ['周末'], title: '公园的傍晚', updatedAt: `${today}T08:00:00.000Z`, updatedBy: member, version: 1 },
  ];

  await page.addInitScript(({ accountFixture, memberFixture }) => {
    window.localStorage.setItem('family-app-token', 'secondary-ui-access-token-0123456789');
    window.localStorage.setItem('family-app-refresh-token', 'secondary-ui-refresh-token-0123456789');
    window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
    window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
  }, { accountFixture: account, memberFixture: member });

  await page.route(`${apiUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/refresh') return json(route, { accessToken, account, member, refreshToken });
    if (path === '/tasks') return json(route, tasks);
    if (path === '/shopping-list') return json(route, shopping);
    if (path === '/inventory') return json(route, inventory);
    if (path === '/inventory-batches' || path === '/inventory-transactions') return json(route, []);
    if (path === '/calendar') return json(route, calendar);
    if (path === '/guests') return json(route, [guest]);
    if (path === '/visits') return json(route, visits);
    if (path === '/guest-wifi-profiles') return json(route, []);
    if (path === '/memories') return json(route, memories);
    if (path === '/members') return json(route, [member]);
    if (path === '/notifications') return json(route, []);
    return json(route, []);
  });
}

const pages = [
  { path: '/tasks', title: '家庭任务', screenshot: 'tasks' },
  { path: '/shopping', title: '采购与库存', screenshot: 'shopping' },
  { path: '/calendar', title: '家庭日历', screenshot: 'calendar' },
  { path: '/guests', title: '访客来访', screenshot: 'guests' },
  { path: '/memories', title: '家庭回忆', screenshot: 'memories' },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function capturePages(page: Page, testInfo: TestInfo, suffix: string) {
  for (const entry of pages) {
    await page.goto(entry.path);
    await expect(page.getByText(entry.title, { exact: true }).first()).toBeVisible();
    if (entry.path === '/memories') {
      const image = page.getByTestId('memory-featured-image');
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((element) => {
        const target = element instanceof HTMLImageElement
          ? element
          : element.querySelector('img');
        return Boolean(target?.complete && target.naturalWidth > 0 && target.naturalHeight > 0);
      })).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`${entry.screenshot}-${suffix}.png`) });
  }
}

test.beforeEach(async ({ page }) => installFixture(page));

test('第二批家庭模块在手机、横屏与桌面保持精细层级', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ height: 812, width: 375 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await capturePages(page, testInfo, 'mobile-light');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await capturePages(page, testInfo, 'mobile-dark');
    await page.setViewportSize({ height: 390, width: 844 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await capturePages(page, testInfo, 'landscape');
    return;
  }

  await page.setViewportSize({ height: 900, width: 1440 });
  await capturePages(page, testInfo, 'desktop');
  const sidebar = page.getByTestId('admin-desktop-sidebar');
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  const children = sidebar.locator('[role="link"], [role="button"]');
  for (const child of await children.all()) {
    const box = await child.boundingBox();
    if (!box || !sidebarBox) continue;
    expect(box.x).toBeGreaterThanOrEqual(sidebarBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1);
  }
});

test('核心操作遵守 44pt 触控契约', async ({ page }) => {
  await page.goto('/tasks');
  await expectTouchTarget(page.getByRole('button', { name: '添加任务', exact: true }).first());
  await page.goto('/shopping');
  await expectTouchTarget(page.getByRole('button', { name: '购物清单', exact: true }));
  await page.goto('/calendar');
  await expectTouchTarget(page.getByRole('button', { name: '添加事件', exact: true }).first());
  await page.goto('/guests');
  await expectTouchTarget(page.getByRole('button', { name: '安排来访', exact: true }));
  await expectTouchTarget(page.getByRole('button', { name: '新增访客', exact: true }));
  await page.goto('/memories');
  await expectTouchTarget(page.getByRole('button', { name: '新建家庭回忆', exact: true }));
});
