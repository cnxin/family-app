import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'account-moviepilot-webhook-fixture',
  loginName: 'moviepilot-webhook-fixture',
  requiresPasswordSetup: false,
};
const member = {
  id: 'member-moviepilot-webhook-fixture',
  householdId: 'household-moviepilot-webhook-fixture',
  name: '回调测试成员',
  avatarEmoji: 'M',
  role: 'owner',
  prefersCooking: false,
};

async function installSession(page: Page) {
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'moviepilot-webhook-token');
      window.localStorage.setItem(
        'family-app-refresh-token',
        'moviepilot-webhook-refresh-token',
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
          accessToken: 'moviepilot-webhook-token-refreshed',
          refreshToken: 'moviepilot-webhook-refresh-token-refreshed',
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

test('Plex 与 MoviePilot 回调地址可生成并通过按钮复制', async ({ page, context }, testInfo) => {
  const connectorSettings = [
    {
      kind: 'plex',
      name: 'Plex',
      role: 'library',
      mode: 'household',
      isEnabled: true,
      baseUrl: 'http://192.168.50.106:32400',
      credentialConfigured: true,
      credentialHint: '****1357',
      isPrimary: true,
      configured: true,
      capabilities: ['library', 'playback'],
      webhookConfigured: false,
      webhookSourceIp: '192.168.50.106',
      webhookUpdatedAt: null,
      playbackServerId: null,
      updatedAt: null,
    },
    {
      kind: 'emby',
      name: 'Emby',
      role: 'library',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: null,
      credentialConfigured: false,
      credentialHint: null,
      isPrimary: false,
      configured: false,
      capabilities: ['library', 'playback'],
      webhookConfigured: false,
      webhookSourceIp: null,
      webhookUpdatedAt: null,
      playbackServerId: null,
      updatedAt: null,
    },
    {
      kind: 'moviepilot',
      name: 'MoviePilot',
      role: 'automation',
      mode: 'household',
      isEnabled: true,
      baseUrl: 'http://192.168.50.106:3000',
      credentialConfigured: true,
      credentialHint: '****2468',
      isPrimary: false,
      configured: true,
      capabilities: ['automation', 'subscription'],
      webhookConfigured: false,
      webhookSourceIp: '192.168.50.106',
      webhookUpdatedAt: null,
      playbackServerId: null,
      updatedAt: '2099-01-01T08:00:00.000Z',
    },
  ];
  await page.route(/\/notifications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(/\/media\/connector-settings$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: connectorSettings }),
    });
  });
  await page.route(
    /\/media\/connector-settings\/moviepilot\/webhook$/,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        sourceIp: '192.168.50.106',
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            callbackPath:
              '/media/webhooks/moviepilot/00000000-0000-4000-8000-000000000099/one-time-fixture-secret',
            sourceIp: '192.168.50.106',
            updatedAt: '2099-01-01T09:00:00.000Z',
          },
        }),
      });
    },
  );
  await page.route(
    /\/media\/connector-settings\/plex\/playback-webhook$/,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        sourceIp: '192.168.50.106',
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            callbackPath:
              '/media/webhooks/playback/plex/00000000-0000-4000-8000-000000000088/one-time-playback-secret',
            sourceIp: '192.168.50.106',
            serverId: 'plex-fixture-server',
            updatedAt: '2099-01-01T09:00:00.000Z',
          },
        }),
      });
    },
  );

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/media/settings');
  await expect(
    page.getByRole('heading', { name: '观影设置', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('MoviePilot 回调允许来源 IP')).toHaveValue(
    '192.168.50.106',
  );
  await page.getByRole('button', { name: 'MoviePilot 生成回调地址', exact: true }).click();

  const callbackUrl =
    'http://localhost:3100/media/webhooks/moviepilot/00000000-0000-4000-8000-000000000099/one-time-fixture-secret';
  await expect(page.getByLabel('MoviePilot 回调地址')).toHaveValue(callbackUrl);
  await expect(
    page.getByRole('button', { name: 'MoviePilot 重新生成回调地址', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'MoviePilot 复制回调地址', exact: true }).click();
  await expect(page.getByText('已复制回调地址', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    callbackUrl,
  );
  await page.getByRole('button', { name: 'Plex 生成回调地址', exact: true }).click();
  await expect(page.getByLabel('Plex 回调地址')).toHaveValue(
    'http://localhost:3100/media/webhooks/playback/plex/00000000-0000-4000-8000-000000000088/one-time-playback-secret',
  );
  await expect(
    page.getByRole('button', { name: 'Plex 重新生成回调地址', exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-webhook-settings.png'),
    fullPage: true,
  });
});

test('影片就绪通知点击后打开对应片单详情', async ({ page }, testInfo) => {
  let read = false;
  const notification = {
    id: 'notification-media-ready-fixture',
    householdId: member.householdId,
    recipientId: member.id,
    module: 'media',
    type: 'media_ready',
    sourceId: 'watchlist-media-ready-fixture',
    title: '影片已就绪',
    body: '「回调完成影片」已完成整理，可以前往媒体库播放',
    targetPath:
      '/media/watchlist?mediaId=watchlist-media-ready-fixture&view=detail',
    readAt: null as string | null,
    createdAt: '2099-01-01T09:00:00.000Z',
  };
  await page.route(/\/notifications\/notification-media-ready-fixture\/read$/, async (route) => {
    read = true;
    notification.readAt = '2099-01-01T09:05:00.000Z';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: notification }),
    });
  });
  await page.route(/\/notifications(?:\?.*)?$/, async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [notification] }),
    });
  });
  await page.route(/\/media\/connectors$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });
  await page.route(/\/media\/requests(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });
  await page.route(/\/media\/library-availability$/, async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"data":{}}' });
  });
  await page.route(/\/polls(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });
  await page.route(/\/media(?:\?.*)?$/, async (route) => {
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
            id: 'watchlist-media-ready-fixture',
            householdId: member.householdId,
            status: 'watchlist',
            scheduledFor: null,
            note: null,
            mediaTitle: {
              id: 'title-media-ready-fixture',
              type: 'movie',
              title: '回调完成影片',
              originalTitle: 'Media Ready Fixture',
              year: 2099,
              overview: '验证影视就绪通知可以直接打开对应片单详情。',
              posterUrl: null,
              externalRefs: [
                { id: 'ref-media-ready-fixture', provider: 'tmdb', externalId: '990099' },
              ],
            },
            createdBy: {
              id: member.id,
              name: member.name,
              avatarEmoji: member.avatarEmoji,
            },
            createdAt: '2099-01-01T08:00:00.000Z',
            updatedAt: '2099-01-01T09:00:00.000Z',
          },
        ],
      }),
    });
  });

  await page.goto('/notifications');
  await expect(page.getByText('观影 ·', { exact: false })).toBeVisible();
  await page.getByText('影片已就绪', { exact: true }).click();
  await expect.poll(() => read).toBe(true);
  await expect(page).toHaveURL(
    /\/media\/watchlist\?mediaId=watchlist-media-ready-fixture&view=detail$/,
  );
  const dialog = page.getByTestId('media-detail-dialog');
  await expect(
    dialog.getByRole('heading', { name: '片单详情', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('验证影视就绪通知可以直接打开对应片单详情。', {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-ready-notification.png'),
    fullPage: true,
  });
});
