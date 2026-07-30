import { expect, test, type Page } from '@playwright/test';

const testAccount = {
  id: 'account-media-detail-fixture',
  loginName: 'media-detail-fixture',
  requiresPasswordSetup: false,
};
const testMember = {
  id: 'member-media-detail-fixture',
  householdId: 'household-media-detail-fixture',
  name: '影视测试成员',
  avatarEmoji: '🎬',
  role: 'owner',
  prefersCooking: false,
};

async function installMockSession(page: Page) {
  await page.addInitScript(
    ({ account, member }) => {
      window.localStorage.setItem('family-app-token', 'media-detail-access-token');
      window.localStorage.setItem('family-app-refresh-token', 'media-detail-refresh-token');
      window.localStorage.setItem('family-app-account', JSON.stringify(account));
      window.localStorage.setItem('family-app-member', JSON.stringify(member));
    },
    { account: testAccount, member: testMember },
  );
  await page.route(/\/auth\/refresh$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          accessToken: 'media-detail-access-token-refreshed',
          refreshToken: 'media-detail-refresh-token-refreshed',
          account: testAccount,
          member: testMember,
        },
      }),
    });
  });
  await page.route(/\/notifications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installMockSession(page);
});

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('媒体库可同步、播放并加入家庭片单', async ({ page }, testInfo) => {
  let householdMediaId: string | null = null;
  const libraryRoute = /\/media\/library(?:\?.*)?$/;
  const syncRoute = /\/media\/library\/sync$/;
  const addRoute = /\/media\/library\/library-focused-fixture\/add$/;
  const posterRoute = /\/media\/library\/poster-focused-fixture\/poster(?:\?.*)?$/;
  let posterRequested = false;

  await page.route(posterRoute, async (route) => {
    posterRequested = true;
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });

  await page.route(libraryRoute, async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [
            {
              id: 'library-focused-fixture',
              connectorKey: 'plex',
              provider: 'plex',
              connectorName: 'Plex',
              libraryItemId: '242',
              type: 'movie',
              title: '媒体库聚焦回归',
              originalTitle: 'Focused Library Regression',
              year: 2099,
              overview: '验证媒体库同步、播放入口与家庭片单导入。',
              posterUrl:
                '/media/library/poster-focused-fixture/poster?expires=4070908800&signature=test',
              externalRefs: [
                { provider: 'tmdb', mediaType: 'movie', externalId: '550' },
                { provider: 'imdb', mediaType: 'movie', externalId: 'tt0137523' },
              ],
              playbackUrl: 'http://plex.test/web/index.html#!/details?key=242',
              householdMediaId,
              lastSeenAt: '2099-01-01T08:30:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 24,
          pages: 1,
          lastSyncedAt: '2099-01-01T08:30:00.000Z',
          connectors: [
            {
              connectorKey: 'plex',
              name: 'Plex',
              provider: 'plex',
              lastSyncedAt: '2099-01-01T08:30:00.000Z',
            },
          ],
        },
      }),
    });
  });
  await page.route(syncRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          results: [
            {
              connectorKey: 'plex',
              name: 'Plex',
              provider: 'plex',
              itemCount: 1,
              matchedCount: 0,
              syncedAt: '2099-01-01T08:30:00.000Z',
            },
          ],
        },
      }),
    });
  });
  await page.route(addRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    householdMediaId = 'media-focused-fixture';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { householdMediaId, added: true },
      }),
    });
  });

  await page.goto('/media/library');
  await expect(page.getByRole('heading', { name: '我的媒体库' })).toBeVisible();
  await expect(page.getByText('媒体库聚焦回归', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: '媒体库聚焦回归海报', exact: true }),
  ).toBeVisible();
  await expect.poll(() => posterRequested).toBe(true);
  await expect(
    page.getByRole('link', { name: '用Plex播放媒体库聚焦回归' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '查看媒体库聚焦回归详情', exact: true })
    .click();
  const libraryDialog = page.getByTestId('media-detail-dialog');
  await expect(
    libraryDialog.getByRole('heading', { name: '媒体库详情', exact: true }),
  ).toBeVisible();
  await expect(
    libraryDialog.getByText('Focused Library Regression', { exact: true }),
  ).toBeVisible();
  await expect(
    libraryDialog.getByText('验证媒体库同步、播放入口与家庭片单导入。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    libraryDialog.getByRole('button', {
      name: '从详情将媒体库聚焦回归加入家庭片单',
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(220);
  await page.screenshot({
    path: testInfo.outputPath('media-library-detail.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '同步媒体库' }).click();
  await expect(
    page.getByText('已同步 1 部，关联家庭片单 0 部', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '将媒体库聚焦回归加入家庭片单' })
    .click();
  await expect(page.getByText('已在片单', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-library-focused.png'),
    fullPage: true,
  });
});

test('家庭片单可打开完整影视详情', async ({ page }, testInfo) => {
  const mediaRoute = /\/media(?:\?.*)?$/;
  const connectorsRoute = /\/media\/connectors$/;
  const requestsRoute = /\/media\/requests(?:\?.*)?$/;
  const availabilityRoute = /\/media\/library-availability$/;
  const pollsRoute = /\/polls(?:\?.*)?$/;

  await page.route(connectorsRoute, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            key: 'plex',
            kind: 'plex',
            name: 'Plex',
            role: 'library',
            primary: true,
            state: 'online',
            available: true,
            message: 'Plex 已连接',
            checkedAt: '2099-01-02T08:30:00.000Z',
          },
        ],
      }),
    });
  });
  await page.route(requestsRoute, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(availabilityRoute, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          'watchlist-detail-fixture': [
            {
              connectorKey: 'plex',
              provider: 'plex',
              name: 'Plex',
              primary: true,
              libraryItemId: '242',
              playbackUrl: 'http://plex.test/web/index.html#!/details?key=242',
            },
          ],
        },
      }),
    });
  });
  await page.route(pollsRoute, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(mediaRoute, async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'watchlist-detail-fixture',
            householdId: 'household-media-detail-fixture',
            status: 'watchlist',
            scheduledFor: '2099-01-09',
            note: '周末一起看，准备饮料和零食。',
            mediaTitle: {
              id: 'title-watchlist-detail-fixture',
              type: 'movie',
              title: '家庭片单详情回归',
              originalTitle: 'Watchlist Detail Regression',
              year: 2099,
              overview: '验证家庭片单中的完整简介、排期、备注与播放位置。',
              posterUrl: null,
              externalRefs: [
                { id: 'ref-watchlist-detail-fixture', provider: 'tmdb', externalId: '990242' },
              ],
            },
            createdBy: {
              id: 'member-media-detail-fixture',
              name: '影视测试成员',
              avatarEmoji: '🎬',
            },
            createdAt: '2099-01-02T08:30:00.000Z',
            updatedAt: '2099-01-02T08:30:00.000Z',
          },
          ...Array.from({ length: 7 }, (_, index) => {
            const number = index + 2;
            return {
              id: `watchlist-scroll-fixture-${number}`,
              householdId: 'household-media-detail-fixture',
              status: 'watchlist',
              scheduledFor: null,
              note: null,
              mediaTitle: {
                id: `title-watchlist-scroll-fixture-${number}`,
                type: number % 2 === 0 ? 'series' : 'movie',
                title: `家庭片单滚动样例 ${number}`,
                originalTitle: null,
                year: 2099 - number,
                overview: '用于验证整页滚动时，标题、搜索与筛选区域不会固定。',
                posterUrl: null,
                externalRefs: [],
              },
              createdBy: {
                id: 'member-media-detail-fixture',
                name: '影视测试成员',
                avatarEmoji: '🎬',
              },
              createdAt: '2099-01-02T08:30:00.000Z',
              updatedAt: '2099-01-02T08:30:00.000Z',
            };
          }),
        ],
      }),
    });
  });

  await page.goto('/media/watchlist');
  const watchlistHeading = page.getByRole('heading', { name: '家庭片单', exact: true });
  await expect(watchlistHeading).toBeVisible();
  await expect(page.getByLabel('媒体连接状态')).toHaveCount(0);
  await page
    .getByRole('button', { name: '查看家庭片单详情回归详情', exact: true })
    .click();
  const watchlistDialog = page.getByTestId('media-detail-dialog');
  await expect(
    watchlistDialog.getByRole('heading', { name: '片单详情', exact: true }),
  ).toBeVisible();
  await expect(
    watchlistDialog.getByText('Watchlist Detail Regression', { exact: true }),
  ).toBeVisible();
  await expect(
    watchlistDialog.getByText('验证家庭片单中的完整简介、排期、备注与播放位置。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    watchlistDialog.getByText('周末一起看，准备饮料和零食。', { exact: true }),
  ).toBeVisible();
  await expect(
    watchlistDialog.getByRole('link', {
      name: '在详情中用Plex播放家庭片单详情回归',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    watchlistDialog.getByRole('button', {
      name: '从详情编辑家庭片单详情回归',
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(220);
  await page.screenshot({
    path: testInfo.outputPath('watchlist-detail.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(watchlistDialog).not.toBeVisible();

  const lastEntry = page.getByText('家庭片单滚动样例 8', { exact: true });
  await lastEntry.scrollIntoViewIfNeeded();
  await expect(lastEntry).toBeVisible();
  const headingBottom = await watchlistHeading.evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  expect(headingBottom).toBeLessThan(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('watchlist-scrolled.png'),
  });
});
