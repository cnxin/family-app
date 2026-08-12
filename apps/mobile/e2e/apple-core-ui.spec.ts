import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const account = {
  id: 'account-apple-core-ui',
  loginName: 'apple-core-ui',
  requiresPasswordSetup: false,
};
const member = {
  avatarEmoji: '家',
  householdId: 'household-apple-core-ui',
  id: 'member-apple-core-ui',
  name: '家庭管理员',
  prefersCooking: true,
  role: 'owner',
};
const today = new Date().toISOString().slice(0, 10);

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
  await page.addInitScript(({ accountFixture, memberFixture }) => {
    window.localStorage.setItem('family-app-token', 'apple-core-ui-token');
    window.localStorage.setItem('family-app-refresh-token', 'apple-core-ui-refresh');
    window.localStorage.setItem('family-app-account', JSON.stringify(accountFixture));
    window.localStorage.setItem('family-app-member', JSON.stringify(memberFixture));
  }, { accountFixture: account, memberFixture: member });

  const dishes = [
    { id: 'dish-1', name: '番茄炖牛腩', category: '荤菜' },
    { id: 'dish-2', name: '清炒时蔬', category: '素菜' },
    { id: 'dish-3', name: '菌菇豆腐汤', category: '汤' },
  ].map((dish) => ({
    ...dish,
    difficulty: 2,
    estMinutes: 30,
    ingredients: [],
    note: null,
    photoUrl: null,
    recipeSteps: [],
    referenceLinks: [],
  }));
  const menu = (id: string, mealType: string, dishIndexes: number[]) => ({
    chef: null,
    chefId: null,
    completedAt: null,
    completedBy: null,
    date: today,
    id,
    items: dishIndexes.map((dishIndex, index) => ({
      assignedTo: null,
      assignedToId: null,
      createdAt: `${today}T08:00:00.000Z`,
      dish: dishes[dishIndex],
      dishId: dishes[dishIndex].id,
      id: `${id}-item-${index}`,
      note: null,
      recipeSnapshot: null,
      recipeVariantId: null,
      requestedBy: member,
      status: 'accepted',
      statusReason: null,
    })),
    mealType,
    status: 'open',
  });
  const menus = [
    menu('menu-breakfast', 'breakfast', [1]),
    menu('menu-lunch', 'lunch', [0, 2]),
    menu('menu-dinner', 'dinner', [0, 1, 2]),
  ];
  const poster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz7WJwAAAABJRU5ErkJggg==';
  const media = [
    ['media-1', '海街日记', 'scheduled', dateOffset(1)],
    ['media-2', '机器人之梦', 'scheduled', dateOffset(3)],
    ['media-3', '布达佩斯大饭店', 'watchlist', null],
    ['media-4', '重启人生', 'watching', null],
  ].map(([id, title, status, scheduledFor]) => ({
    createdAt: `${today}T08:00:00.000Z`,
    createdBy: member,
    householdId: member.householdId,
    id,
    mediaTitle: {
      externalRefs: [],
      id: `${id}-title`,
      originalTitle: null,
      overview: null,
      posterUrl: poster,
      title,
      type: status === 'watching' ? 'series' : 'movie',
      year: 2024,
    },
    note: null,
    scheduledFor,
    status,
    updatedAt: `${today}T08:00:00.000Z`,
  }));

  await page.route('http://localhost:3100/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/auth/refresh') {
      await json(route, {
        accessToken: 'apple-core-ui-token-refreshed',
        account,
        member,
        refreshToken: 'apple-core-ui-refresh-refreshed',
      });
      return;
    }
    if (path === '/menus') return json(route, menus);
    if (path === '/dishes') return json(route, dishes);
    if (path === '/shopping-list') {
      return json(route, [{ checked: false, customName: '牛奶', id: 'shopping-1' }]);
    }
    if (path === '/media') return json(route, media);
    if (path === '/media/connectors') {
      return json(route, [
        { available: true, checkedAt: new Date().toISOString(), key: 'plex', kind: 'plex', message: '媒体库已同步', name: 'Plex', primary: true, role: 'library', state: 'online' },
        { available: true, checkedAt: new Date().toISOString(), key: 'moviepilot', kind: 'moviepilot', message: '订阅服务在线', name: 'MoviePilot', primary: false, role: 'automation', state: 'online' },
      ]);
    }
    if (path === '/media/viewing-sessions') return json(route, [{ id: 'session-1' }]);
    if (path === '/polls') {
      return json(route, [{
        canManage: true,
        canVote: true,
        category: 'movie',
        closedAt: null,
        closedBy: null,
        closedById: null,
        closesAt: null,
        createdAt: `${today}T08:00:00.000Z`,
        createdBy: member,
        createdById: member.id,
        description: '一起选一部周末电影',
        id: 'poll-1',
        maxChoices: 1,
        options: [],
        selectedOptionIds: [],
        sourceId: null,
        sourceModule: 'media',
        status: 'open',
        title: '周末观影投票',
        totalVoters: 0,
        totalVotes: 0,
        updatedAt: `${today}T08:00:00.000Z`,
        voteMode: 'single',
      }]);
    }
    if (path === '/notifications') return json(route, []);
    if (path === '/finance/summary') {
      return json(route, { accounts: [], budgets: [], categories: [], categorySpending: [], currency: 'CNY', expense: 0, income: 0, month: today.slice(0, 7), net: 0, totalBalance: 0 });
    }
    if (path === '/agent/status') {
      return json(route, { enabled: true, selected: { available: true, kind: 'fake', name: '本地摘要' } });
    }
    return json(route, []);
  });
}

const pages = [
  { path: '/', title: '今天需要关注', screenshot: 'home' },
  { path: '/canteen', title: '家庭食堂', screenshot: 'canteen' },
  { path: '/media', title: '家庭观影', screenshot: 'media' },
] as const;

test.beforeEach(async ({ page }) => {
  await installFixture(page);
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.root).toBeLessThanOrEqual(1);
}

async function capturePages(
  page: Page,
  testInfo: TestInfo,
  suffix: string,
) {
  for (const entry of pages) {
    await page.goto(entry.path);
    await expect(page.getByText(entry.title, { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`${entry.screenshot}-${suffix}.png`),
    });
  }
}

test('核心模块在移动明暗色、横屏和桌面宽屏保持原生层级', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await capturePages(page, testInfo, 'mobile-light');

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await capturePages(page, testInfo, 'mobile-dark');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await capturePages(page, testInfo, 'mobile-landscape');
    return;
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await capturePages(page, testInfo, 'desktop-light');
});
