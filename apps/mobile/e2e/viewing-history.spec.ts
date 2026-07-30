import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'account-viewing-history-fixture',
  loginName: 'viewing-history-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: 'member-viewing-history-fixture',
  householdId: 'household-viewing-history-fixture',
  name: '妈妈',
  avatarEmoji: 'M',
  role: 'member',
  prefersCooking: false,
};

async function installSession(page: Page) {
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'viewing-history-token');
      window.localStorage.setItem(
        'family-app-refresh-token',
        'viewing-history-refresh-token',
      );
      window.localStorage.setItem(
        'family-app-account',
        JSON.stringify(accountFixture),
      );
      window.localStorage.setItem(
        'family-app-member',
        JSON.stringify(memberFixture),
      );
    },
    { accountFixture: account, memberFixture: member },
  );
  await page.route(/\/auth\/refresh$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          accessToken: 'viewing-history-token-refreshed',
          refreshToken: 'viewing-history-refresh-token-refreshed',
          account,
          member,
        },
      }),
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await installSession(page);
});

test('观看记录显示成员、播放状态和筛选结果', async ({ page }, testInfo) => {
  const sessions = [
    {
      id: 'viewing-session-active',
      provider: 'plex',
      connectorName: '家庭 Plex',
      mediaLibraryItemId: 'library-active',
      mediaTitleId: 'title-active',
      libraryItemId: 'plex-series-1',
      contentItemId: 'plex-episode-8',
      mediaType: 'series',
      title: '周末剧场 · 第八集',
      deviceName: '客厅电视',
      status: 'active',
      positionMs: 1_800_000,
      durationMs: 3_600_000,
      percentage: 50,
      startedAt: '2099-06-08T10:00:00.000Z',
      endedAt: null,
      lastEventAt: '2099-06-08T10:30:00.000Z',
      posterUrl: null,
      playbackUrl: null,
      participants: [
        {
          id: 'participant-active',
          member: { id: member.id, name: member.name, avatarEmoji: member.avatarEmoji },
          joinedAt: '2099-06-08T10:00:00.000Z',
          lastSeenAt: '2099-06-08T10:30:00.000Z',
        },
      ],
    },
    {
      id: 'viewing-session-completed',
      provider: 'emby',
      connectorName: '家庭 Emby',
      mediaLibraryItemId: 'library-completed',
      mediaTitleId: 'title-completed',
      libraryItemId: 'emby-movie-2',
      contentItemId: 'emby-movie-2',
      mediaType: 'movie',
      title: '周末电影',
      deviceName: '书房浏览器',
      status: 'completed',
      positionMs: 7_100_000,
      durationMs: 7_200_000,
      percentage: 98.6,
      startedAt: '2099-06-07T12:00:00.000Z',
      endedAt: '2099-06-07T14:00:00.000Z',
      lastEventAt: '2099-06-07T14:00:00.000Z',
      posterUrl: null,
      playbackUrl: 'http://emby.example/item/2',
      participants: [
        {
          id: 'participant-completed',
          member: { id: 'member-dad', name: '爸爸', avatarEmoji: 'D' },
          joinedAt: '2099-06-07T12:00:00.000Z',
          lastSeenAt: '2099-06-07T14:00:00.000Z',
        },
      ],
    },
  ];
  await page.route(/\/notifications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(/\/media\/viewing-sessions$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: sessions }),
    });
  });

  await page.goto('/media/history');
  await expect(page.getByRole('heading', { name: '观看记录', exact: true })).toBeVisible();
  await expect(page.getByText('周末剧场 · 第八集', { exact: true })).toBeVisible();
  await expect(page.getByText('播放中', { exact: true })).toBeVisible();
  await expect(page.getByText('妈妈 · 客厅电视', { exact: true })).toBeVisible();
  await expect(page.getByText('周末电影', { exact: true })).toBeVisible();
  await expect(page.getByText('已看完', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '已结束', exact: true }).click();
  await expect(page.getByText('周末电影', { exact: true })).toBeVisible();
  await expect(page.getByText('周末剧场 · 第八集', { exact: true })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('viewing-history.png'),
    fullPage: true,
  });
});
