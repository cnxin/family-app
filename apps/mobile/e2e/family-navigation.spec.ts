import { expect, test, type Page } from '@playwright/test';

const API_URL = process.env.FAMILY_API_URL ?? 'http://127.0.0.1:3100';

const NAVIGATION = {
  home: { mobile: '首页', desktop: '家庭首页', path: '/', group: 'daily' },
  order: { mobile: '点菜', desktop: '点菜', path: '/order', module: '家庭食堂', group: 'daily' },
  kitchen: { mobile: '菜单安排', desktop: '菜单安排', path: '/kitchen', module: '家庭食堂', group: 'daily' },
  calendar: { mobile: '日历', desktop: '家庭日历', path: '/calendar', group: 'schedule' },
  shopping: { mobile: '采购与库存', desktop: '采购与库存', path: '/shopping', module: '采购与库存', group: 'daily' },
  profile: { mobile: '我的', desktop: '我的', path: '/profile', group: 'system' },
} as const;

type NavigationKey = keyof typeof NAVIGATION;

async function openSection(
  page: Page,
  projectName: string,
  section: NavigationKey,
) {
  const target = NAVIGATION[section];
  const module = 'module' in target ? target.module : null;
  if (module) {
    if (projectName === 'mobile-chrome') {
      await page.getByRole('tab', { name: '首页', exact: true }).click();
      const moduleLink = page.getByRole('link').filter({ hasText: module }).first();
      await expect(moduleLink).toBeVisible();
      await moduleLink.click();
      if (module === target.desktop) {
        await expect(page).toHaveURL(new RegExp(`${target.path}$`));
        return;
      }
    } else if (module === '家庭食堂') {
      const moduleLink = page.getByRole('link', { name: module, exact: true });
      await expect(moduleLink).toBeVisible();
      await moduleLink.click();
    }
  }

  if (projectName === 'desktop-chrome') {
    const targetLink = page.getByRole('link', { name: target.desktop, exact: true }).first();
    if (!(await targetLink.isVisible())) {
      const group = page.getByTestId(`desktop-nav-group-${target.group}`);
      if (!(await group.isDisabled())) await group.click();
    }
  }

  const locator = projectName === 'mobile-chrome'
    ? module
      ? page.getByRole('link').filter({ hasText: target.mobile }).first()
      : page.getByRole('tab', { name: target.mobile, exact: true })
    : page.getByRole('link', { name: target.desktop, exact: true }).first();

  await expect(locator).toBeVisible();
  await locator.click();
  await expect(page).toHaveURL(
    target.path === '/' ? /\/$/ : new RegExp(`${target.path}$`),
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(
    dimensions.rootClientWidth,
  );
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(
    dimensions.bodyClientWidth,
  );
}

async function ensureIsolatedManagerLogin(page: Page) {
  await page.goto('/');
  if (!/\/login\/?$/.test(new URL(page.url()).pathname)) return;

  const testPassword = process.env.E2E_ACCOUNT_PASSWORD;
  expect(
    testPassword,
    '隔离浏览器回归缺少 E2E_ACCOUNT_PASSWORD，拒绝猜测或修改开发账号密码',
  ).toBeTruthy();
  await page.getByPlaceholder('输入账号').fill(process.env.E2E_LOGIN_NAME ?? '爸爸');
  await page.getByPlaceholder('输入密码').fill(testPassword!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login\/?$/);
}

test('家庭成员可浏览核心页面且布局不横向溢出', async (
  { page, request },
  testInfo,
) => {
  test.setTimeout(180_000);
  const runtimeErrors: string[] = [];
  let expectedUnauthorizedConsoleErrors = 0;
  let acceptingInitialRefreshUnauthorized = true;
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const locationUrl = message.location().url;
    if (
      acceptingInitialRefreshUnauthorized &&
      message.text().includes('status of 401') &&
      locationUrl &&
      new URL(locationUrl).pathname === '/auth/refresh'
    ) {
      return;
    }
    if (
      expectedUnauthorizedConsoleErrors > 0 &&
      message.text().includes('status of 401')
    ) {
      expectedUnauthorizedConsoleErrors -= 1;
      return;
    }
    runtimeErrors.push(message.text());
  });

  await ensureIsolatedManagerLogin(page);
  acceptingInitialRefreshUnauthorized = false;
  await expect(
    page.getByText('家庭工作台', { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  let forcedUnauthorized = 0;
  let refreshRequests = 0;
  const presentedRefreshTokens: string[] = [];
  let rejectedAuthorization: string | undefined;
  const staleAccessRoute =
    /\/(dishes|menus|shopping-list|tasks|polls|reminders|notifications)(\?|$)/;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/refresh') {
      refreshRequests += 1;
      const body = request.postDataJSON() as { refreshToken?: string } | null;
      if (body?.refreshToken) presentedRefreshTokens.push(body.refreshToken);
    }
  });
  await page.route(staleAccessRoute, async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.continue();
      return;
    }
    const authorization = request.headers().authorization;
    if (!rejectedAuthorization) rejectedAuthorization = authorization;
    if (
      request.method() === 'GET' &&
      authorization === rejectedAuthorization &&
      forcedUnauthorized < 1
    ) {
      forcedUnauthorized += 1;
      expectedUnauthorizedConsoleErrors += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: '测试访问令牌失效' },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`/?authRecovery=${Date.now()}`);
  await expect(
    page.getByText('家庭工作台', { exact: true }),
  ).toBeVisible();
  expect(forcedUnauthorized).toBe(1);
  expect(refreshRequests).toBeGreaterThanOrEqual(1);
  expect(refreshRequests).toBeLessThanOrEqual(2);
  expect(new Set(presentedRefreshTokens).size).toBe(
    presentedRefreshTokens.length,
  );
  await page.waitForLoadState('networkidle');
  await page.unroute(staleAccessRoute);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('platform-home.png'),
    fullPage: true,
  });

  const canteenLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link').filter({ hasText: '家庭食堂' }).first()
      : page.getByRole('link', { name: '家庭食堂', exact: true });
  await canteenLink.click();
  await expect(page).toHaveURL(/\/canteen$/);
  await expect(page.getByRole('heading', { name: '家庭食堂', exact: true })).toBeVisible();
  await expect(page.getByText('今日菜单', { exact: true }).last()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('canteen-home.png'),
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回家庭首页', exact: true }).click();
  } else {
    await page.getByRole('link', { name: '家庭首页', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);

  const mediaRoute = /\/media(\?|$)/;
  const mediaConnectorsRoute = /\/media\/connectors(\?|$)/;
  const mediaConnectorSettingsRoute =
    /\/media\/connector-settings(?:\/[^/?]+)?(?:\/test)?(?:\?|$)/;
  const mediaSourcesRoute = /\/media\/metadata-sources(?:\/[^/?]+)?(?:\?|$)/;
  const mediaSearchRoute = /\/media\/search\?/;
  const mediaAvailabilityRoute = /\/media\/library-availability(\?|$)/;
  const mediaLibraryRoute = /\/media\/library(?:\?.*)?$/;
  const mediaLibrarySyncRoute = /\/media\/library\/sync$/;
  const mediaLibraryAddRoute =
    /\/media\/library\/library-browser-fixture-1\/add$/;
  const mediaRequestsRoute = /\/media\/requests(\?|$)/;
  const mediaRequestActionRoute =
    /\/media\/requests\/media-request-browser-fixture-\d+(\/refresh)?$/;
  const mediaSubscribeRoute =
    /\/media\/media-browser-fixture-1\/requests$/;
  const mediaExternalRefsRoute =
    /\/media\/media-browser-fixture-2\/external-refs$/;
  const linkedPollRoute = /\/polls(\?|$)/;
  const linkedPollVoteRoute = /\/polls\/poll-browser-fixture-media-[12]\/votes$/;
  let linkedPollFixture: Record<string, unknown> | null = null;
  let mediaFixtureStatus = 'watchlist';
  let mediaFixture2Status = 'watchlist';
  let mediaFixture2TmdbId: string | null = null;
  let mediaRequestSequence = 0;
  let mediaRequestFixtures: Record<string, unknown>[] = [];
  let libraryHouseholdMediaId: string | null = null;
  let mediaSourceConfigs: {
    provider: string;
    name: string;
    mode: string;
    isEnabled: boolean;
    baseUrl: string | null;
    credentialKind: string;
    credentialConfigured: boolean;
    credentialHint: string | null;
    configured: boolean;
    settings: Record<string, string>;
    updatedAt: string | null;
  }[] = [
    {
      provider: 'tmdb',
      name: 'TMDB',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: 'https://api.themoviedb.org/3',
      credentialKind: 'token',
      credentialConfigured: false,
      credentialHint: null,
      configured: false,
      settings: { imageBaseUrl: 'https://image.tmdb.org/t/p/w500' },
      updatedAt: null,
    },
    {
      provider: 'douban',
      name: '豆瓣',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: null,
      credentialKind: 'token',
      credentialConfigured: false,
      credentialHint: null,
      configured: false,
      settings: {},
      updatedAt: null,
    },
    {
      provider: 'bangumi',
      name: 'Bangumi',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: 'https://api.bgm.tv',
      credentialKind: 'token',
      credentialConfigured: false,
      credentialHint: null,
      configured: true,
      settings: { userAgent: 'family-app-browser-test/1.0' },
      updatedAt: null,
    },
  ];
  let mediaConnectorSettings: {
    kind: string;
    name: string;
    role: string;
    mode: string;
    isEnabled: boolean;
    baseUrl: string | null;
    credentialConfigured: boolean;
    credentialHint: string | null;
    isPrimary: boolean;
    configured: boolean;
    capabilities: string[];
    updatedAt: string | null;
  }[] = [
    {
      kind: 'plex',
      name: 'Plex',
      role: 'library',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: 'http://plex.test',
      credentialConfigured: false,
      credentialHint: null,
      isPrimary: true,
      configured: false,
      capabilities: ['library', 'playback'],
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
      updatedAt: null,
    },
    {
      kind: 'moviepilot',
      name: 'MoviePilot',
      role: 'automation',
      mode: 'server_default',
      isEnabled: true,
      baseUrl: 'http://moviepilot.test',
      credentialConfigured: true,
      credentialHint: '服务器默认',
      isPrimary: false,
      configured: true,
      capabilities: ['automation', 'subscription'],
      updatedAt: null,
    },
  ];
  await page.route(mediaRoute, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'media-browser-fixture-1',
            householdId: 'household-browser-fixture',
            status: mediaFixtureStatus,
            scheduledFor: null,
            note: '周末家庭观影',
            mediaTitle: {
              id: 'title-browser-fixture-1',
              type: 'movie',
              title: '家庭电影回归样例',
              originalTitle: 'Family Movie Fixture',
              year: 2099,
              overview: '用于验证移动端和桌面端片单卡片、状态与排期的稳定布局。',
              posterUrl: null,
              externalRefs: [
                { id: 'ref-browser-fixture-1', provider: 'tmdb', externalId: '999001' },
              ],
            },
            createdBy: { id: 'member-browser-fixture', name: '爸爸', avatarEmoji: '👨' },
            createdAt: '2099-01-01T00:00:00.000Z',
            updatedAt: '2099-01-01T00:00:00.000Z',
          },
          {
            id: 'media-browser-fixture-2',
            householdId: 'household-browser-fixture',
            status: mediaFixture2Status,
            scheduledFor: null,
            note: '全家已看完',
            mediaTitle: {
              id: 'title-browser-fixture-2',
              type: 'series',
              title: '家庭剧集回归样例',
              originalTitle: null,
              year: 2098,
              overview: '用于验证没有海报和排期时的稳定回退状态。',
              posterUrl: null,
              externalRefs: [
                { id: 'ref-browser-fixture-2', provider: 'imdb', externalId: 'tt999002' },
                ...(mediaFixture2TmdbId
                  ? [
                      {
                        id: 'ref-browser-fixture-2-tmdb',
                        provider: 'tmdb',
                        externalId: mediaFixture2TmdbId,
                      },
                    ]
                  : []),
              ],
            },
            createdBy: { id: 'member-browser-fixture', name: '爸爸', avatarEmoji: '👨' },
            createdAt: '2099-01-01T00:00:00.000Z',
            updatedAt: '2099-01-01T00:00:00.000Z',
          },
        ].filter((entry) => {
          const requestedStatus = new URL(route.request().url()).searchParams.get('status');
          return !requestedStatus || requestedStatus === 'all' || entry.status === requestedStatus;
        }),
      }),
    });
  });
  await page.route(mediaSourcesRoute, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mediaSourceConfigs }),
      });
      return;
    }
    const provider = new URL(route.request().url()).pathname.split('/').at(-1);
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as {
        isEnabled: boolean;
        baseUrl: string | null;
        credentialKind: 'token' | 'api_key';
        credential?: string;
        imageBaseUrl?: string | null;
        userAgent?: string | null;
      };
      expect(body.credential).toBe('browser-source-secret-2468');
      mediaSourceConfigs = mediaSourceConfigs.map((config) =>
        config.provider === provider
          ? {
              ...config,
              mode: 'household',
              isEnabled: body.isEnabled,
              baseUrl: body.baseUrl,
              credentialKind: body.credentialKind,
              credentialConfigured: true,
              credentialHint: '****2468',
              configured: true,
              settings: {
                ...(body.imageBaseUrl ? { imageBaseUrl: body.imageBaseUrl } : {}),
                ...(body.userAgent ? { userAgent: body.userAgent } : {}),
              },
              updatedAt: '2099-01-01T00:00:00.000Z',
            }
          : config,
      );
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: mediaSourceConfigs }),
    });
  });
  await page.route(mediaConnectorSettingsRoute, async (route) => {
    const method = route.request().method();
    const parts = new URL(route.request().url()).pathname.split('/');
    const kind = parts.at(-1) === 'test' ? parts.at(-2) : parts.at(-1);
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mediaConnectorSettings }),
      });
      return;
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as {
        name: string;
        isEnabled: boolean;
        baseUrl: string | null;
        credential?: string;
        isPrimary?: boolean;
      };
      expect(body.credential).toBe('browser-connector-secret-8642');
      mediaConnectorSettings = mediaConnectorSettings.map((config) =>
        config.kind === kind
          ? {
              ...config,
              name: body.name,
              mode: 'household',
              isEnabled: body.isEnabled,
              baseUrl: body.baseUrl,
              credentialConfigured: true,
              credentialHint: '****8642',
              isPrimary: body.isPrimary ?? false,
              configured: true,
              updatedAt: '2099-01-01T00:00:00.000Z',
            }
          : config,
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mediaConnectorSettings }),
      });
      return;
    }
    if (method === 'POST' && parts.at(-1) === 'test') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            key: kind,
            kind,
            name: kind === 'plex' ? 'Plex' : kind,
            role: kind === 'moviepilot' ? 'automation' : 'library',
            primary: kind === 'plex',
            state: 'online',
            available: true,
            message: kind === 'plex' ? 'Plex 1.43.0' : '已连接',
            checkedAt: '2099-01-01T00:00:00.000Z',
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 405 });
  });
  await page.route(mediaConnectorsRoute, async (route) => {
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
            message: 'Plex 1.43.0',
            checkedAt: '2099-01-01T00:00:00.000Z',
          },
          {
            key: 'emby',
            kind: 'emby',
            name: 'Emby',
            role: 'library',
            primary: false,
            state: 'not_configured',
            available: false,
            message: '未配置服务地址',
            checkedAt: null,
          },
          {
            key: 'moviepilot',
            kind: 'moviepilot',
            name: 'MoviePilot',
            role: 'automation',
            primary: false,
            state: 'online',
            available: true,
            message: 'MoviePilot v2.9.0',
            checkedAt: '2099-01-01T00:00:00.000Z',
          },
        ],
      }),
    });
  });
  await page.route(mediaLibraryRoute, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [
            {
              id: 'library-browser-fixture-1',
              connectorKey: 'plex',
              provider: 'plex',
              connectorName: 'Plex',
              libraryItemId: '242',
              type: 'movie',
              title: '媒体库回归样例',
              originalTitle: 'Library Regression Fixture',
              year: 2099,
              overview: '验证媒体库同步、播放入口与家庭片单导入。',
              posterUrl: null,
              externalRefs: [
                { provider: 'tmdb', mediaType: 'movie', externalId: '550' },
                { provider: 'imdb', mediaType: 'movie', externalId: 'tt0137523' },
              ],
              playbackUrl: 'http://plex.test/web/index.html#!/details?key=242',
              householdMediaId: libraryHouseholdMediaId,
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
  await page.route(mediaLibrarySyncRoute, async (route) => {
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
  await page.route(mediaLibraryAddRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    libraryHouseholdMediaId = 'media-browser-fixture-library';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { householdMediaId: libraryHouseholdMediaId, added: true },
      }),
    });
  });
  await page.route(mediaExternalRefsRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as {
      externalRefs: { provider: string; externalId: string }[];
    };
    expect(body.externalRefs).toEqual([
      { provider: 'tmdb', externalId: '999002' },
    ]);
    mediaFixture2TmdbId = '999002';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id: 'media-browser-fixture-2' } }),
    });
  });
  await page.route(mediaSearchRoute, async (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    expect(url.searchParams.get('query')).toBe('三源搜索样例');
    expect(url.searchParams.get('type')).toBe('movie');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          query: '三源搜索样例',
          results: [
            {
              key: 'douban:movie:browser-search-1',
              type: 'movie',
              title: '三源搜索候选电影',
              originalTitle: 'Three-source Search Fixture',
              year: 2097,
              overview: '来自豆瓣与 TMDB 合并后的家庭片单候选。',
              posterUrl: null,
              sources: ['douban', 'tmdb'],
              externalRefs: [
                {
                  provider: 'douban',
                  mediaType: 'movie',
                  externalId: 'browser-douban-1',
                },
                {
                  provider: 'tmdb',
                  mediaType: 'movie',
                  externalId: '999101',
                },
              ],
              metadata: {},
            },
          ],
          sources: [
            {
              provider: 'douban',
              name: '豆瓣',
              state: 'online',
              resultCount: 1,
              message: '找到 1 条',
            },
            {
              provider: 'tmdb',
              name: 'TMDB',
              state: 'online',
              resultCount: 1,
              message: '找到 1 条',
            },
            {
              provider: 'bangumi',
              name: 'Bangumi',
              state: 'offline',
              resultCount: 0,
              message: '连接超时',
            },
          ],
        },
      }),
    });
  });
  await page.route(mediaAvailabilityRoute, async (route) => {
    const body = route.request().postDataJSON() as { mediaIds: string[] };
    expect(body.mediaIds.length).toBeGreaterThan(0);
    expect(
      body.mediaIds.every((id) =>
        ['media-browser-fixture-1', 'media-browser-fixture-2'].includes(id),
      ),
    ).toBe(true);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          'media-browser-fixture-1': [
            {
              connectorKey: 'plex',
              provider: 'plex',
              name: 'Plex',
              primary: true,
              libraryItemId: '242',
              playbackUrl: 'http://plex.test/web/index.html#!/details?key=242',
            },
          ],
          'media-browser-fixture-2': [],
        },
      }),
    });
  });
  await page.route(mediaRequestsRoute, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: mediaRequestFixtures }),
    });
  });
  await page.route(mediaSubscribeRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      connectorKey: 'moviepilot',
    });
    mediaRequestSequence += 1;
    const request = {
      id: `media-request-browser-fixture-${mediaRequestSequence}`,
      householdMediaId: 'media-browser-fixture-1',
      connectorKey: 'moviepilot',
      season: 0,
      status: 'processing',
      externalRequestId: String(880 + mediaRequestSequence),
      message: null,
      requestedBy: {
        id: 'member-browser-fixture',
        name: '爸爸',
        avatarEmoji: '👨',
      },
      cancelledBy: null,
      canCancel: true,
      lastSyncedAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
    };
    mediaRequestFixtures = [request, ...mediaRequestFixtures];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: request }),
    });
  });
  await page.route(mediaRequestActionRoute, async (route) => {
    const requestId = new URL(route.request().url()).pathname.split('/')[3];
    const current = mediaRequestFixtures.find((item) => item.id === requestId);
    expect(current).toBeTruthy();
    const status = route.request().method() === 'DELETE' ? 'cancelled' : 'completed';
    const updated = {
      ...current,
      status,
      canCancel: false,
      cancelledBy:
        status === 'cancelled'
          ? { id: 'member-browser-fixture', name: '爸爸', avatarEmoji: '👨' }
          : null,
      updatedAt: '2099-01-01T00:05:00.000Z',
    };
    mediaRequestFixtures = mediaRequestFixtures.map((item) =>
      item.id === requestId ? updated : item,
    );
    await route.fulfill({
      status: route.request().method() === 'DELETE' ? 200 : 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: updated }),
    });
  });
  await page.route(linkedPollRoute, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: linkedPollFixture ? [linkedPollFixture] : [] }),
      });
      return;
    }
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      title: string;
      description: string | null;
      category: string;
      voteMode: string;
      maxChoices: number;
      sourceModule?: string;
      sourceId?: string;
      options: { label?: string; mediaId?: string }[];
    };
    const structuredCandidates = body.options.every((option) => option.mediaId);
    if (structuredCandidates) {
      expect(body.sourceModule).toBeUndefined();
      expect(body.sourceId).toBeUndefined();
      expect(body.options.map((option) => option.mediaId)).toEqual([
        'media-browser-fixture-1',
        'media-browser-fixture-2',
      ]);
    } else {
      expect(body.sourceModule).toBe('media');
      expect(body.sourceId).toBe('media-browser-fixture-1');
    }
    linkedPollFixture = {
      id: structuredCandidates
        ? 'poll-browser-fixture-media-2'
        : 'poll-browser-fixture-media-1',
      title: body.title,
      description: body.description,
      category: 'movie',
      voteMode: body.voteMode,
      maxChoices: body.maxChoices,
      closesAt: null,
      status: 'open',
      sourceModule: structuredCandidates ? null : 'media',
      sourceId: structuredCandidates ? null : body.sourceId,
      createdById: 'member-browser-fixture',
      createdBy: { id: 'member-browser-fixture', name: '爸爸', avatarEmoji: '👨' },
      closedById: null,
      closedBy: null,
      closedAt: null,
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2099-01-01T00:00:00.000Z',
      canManage: true,
      canVote: true,
      totalVoters: 0,
      totalVotes: 0,
      selectedOptionIds: [],
      options: body.options.map((option, index) => ({
        id: `poll-browser-fixture-option-${index + 1}`,
        label:
          option.label ??
          (option.mediaId === 'media-browser-fixture-1'
            ? '家庭电影回归样例'
            : '家庭剧集回归样例'),
        description: null,
        mediaId: option.mediaId ?? null,
        media: option.mediaId
          ? {
              id: option.mediaId,
              status: 'voting',
              mediaTitle: {
                id:
                  option.mediaId === 'media-browser-fixture-1'
                    ? 'title-browser-fixture-1'
                    : 'title-browser-fixture-2',
                type:
                  option.mediaId === 'media-browser-fixture-1'
                    ? 'movie'
                    : 'series',
                title:
                  option.mediaId === 'media-browser-fixture-1'
                    ? '家庭电影回归样例'
                    : '家庭剧集回归样例',
                originalTitle:
                  option.mediaId === 'media-browser-fixture-1'
                    ? 'Family Movie Fixture'
                    : null,
                year:
                  option.mediaId === 'media-browser-fixture-1' ? 2099 : 2098,
                posterUrl: null,
              },
            }
          : null,
        sortOrder: index,
        voteCount: 0,
        percentage: 0,
        voters: [],
      })),
    };
    mediaFixtureStatus = 'voting';
    if (structuredCandidates) mediaFixture2Status = 'voting';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: linkedPollFixture }),
    });
  });
  await page.route(linkedPollVoteRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(linkedPollFixture).not.toBeNull();
    const body = route.request().postDataJSON() as { optionIds: string[] };
    const current = linkedPollFixture as {
      selectedOptionIds: string[];
      options: {
        id: string;
        voteCount: number;
        percentage: number;
        voters: unknown[];
      }[];
    };
    current.selectedOptionIds = body.optionIds;
    current.options = current.options.map((option) => ({
      ...option,
      voteCount: body.optionIds.includes(option.id) ? 1 : 0,
      percentage: body.optionIds.includes(option.id) ? 100 : 0,
      voters: body.optionIds.includes(option.id)
        ? [{ id: 'member-browser-fixture', name: '爸爸', avatarEmoji: '👨' }]
        : [],
    }));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: current }),
    });
  });

  // 首页会预取片单；重载后让新建的路由 mock 填充查询缓存。
  await page.reload();
  await expect(page.getByText('家庭工作台', { exact: true })).toBeVisible();

  const mediaLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link').filter({ hasText: '家庭观影' })
      : page.getByRole('link', { name: '家庭观影', exact: true });
  await expect(mediaLink).toBeVisible();
  await mediaLink.click();
  await expect(page).toHaveURL(/\/media$/);
  await expect(page.getByRole('heading', { name: '家庭观影', exact: true })).toBeVisible();
  await expect(page.getByText('媒体服务', { exact: true })).toBeVisible();
  await expect(page.getByText('媒体库 · Plex 1.43.0', { exact: true })).toBeVisible();
  await expect(page.getByText('自动化 · MoviePilot v2.9.0', { exact: true })).toBeVisible();
  await expect(page.getByText('媒体库 · 未配置服务地址', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /观影设置/ }).click();
  await expect(page).toHaveURL(/\/media\/settings$/);
  await expect(page.getByRole('heading', { name: '观影设置', exact: true })).toBeVisible();
  await expect(page.getByLabel('Plex Token')).toHaveValue('');
  await page.getByLabel('Plex Token').fill('browser-connector-secret-8642');
  await page.getByRole('button', { name: '保存并测试', exact: true }).first().click();
  await expect(page.getByText('连接成功 · Plex 1.43.0', { exact: true })).toBeVisible();
  await expect(page.getByText('****8642', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Plex Token')).toHaveValue('');
  await expect(page.getByText('browser-connector-secret-8642')).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-connector-settings.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '搜索数据源', exact: true }).click();
  await expect(page).toHaveURL(/\/media\/settings\?section=sources$/);
  await expect(page.getByLabel('TMDB API Token')).toHaveValue('');
  await page.getByLabel('TMDB API Token').fill('browser-source-secret-2468');
  await page.getByRole('button', { name: '保存 TMDB', exact: true }).click();
  await expect(page.getByText('****2468', { exact: true })).toBeVisible();
  await expect(page.getByLabel('TMDB API Token')).toHaveValue('');
  await expect(page.getByText('browser-source-secret-2468')).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-source-settings.png'),
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回家庭观影', exact: true }).click();
  } else {
    await page.getByRole('link', { name: '家庭观影', exact: true }).first().click();
  }
  await expect(page).toHaveURL(/\/media$/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-home.png'),
    fullPage: true,
  });
  await page.getByRole('link').filter({ hasText: '观影投票' }).first().click();
  await expect(page).toHaveURL(/\/media\/polls(?:\?returnTo=media)?$/);
  await expect(page.getByRole('heading', { name: '观影投票', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回家庭观影', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: '返回家庭观影', exact: true }).click();
  await expect(page).toHaveURL(/\/media$/);
  await page.getByRole('link').filter({ hasText: '我的媒体库' }).first().click();
  await expect(page).toHaveURL(/\/media\/library$/);
  await expect(page.getByRole('heading', { name: '我的媒体库', exact: true })).toBeVisible();
  await expect(page.getByText('媒体库回归样例', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '用Plex播放媒体库回归样例' })).toBeVisible();
  await page.getByRole('button', { name: '同步媒体库', exact: true }).click();
  await expect(page.getByText('已同步 1 部，关联家庭片单 0 部', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '将媒体库回归样例加入家庭片单' }).click();
  await expect(page.getByText('已在片单', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-library.png'),
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回观影首页', exact: true }).click();
  } else {
    await page.getByRole('link', { name: '观影首页', exact: true }).first().click();
  }
  await expect(page).toHaveURL(/\/media$/);
  await page.getByRole('link').filter({ hasText: '家庭片单' }).first().click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(page.getByRole('heading', { name: '家庭片单', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '用Plex播放家庭电影回归样例' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '查看家庭电影回归样例详情', exact: true })
    .click();
  const mediaDetailDialog = page.getByTestId('media-detail-dialog');
  await expect(
    mediaDetailDialog.getByRole('heading', { name: '片单详情', exact: true }),
  ).toBeVisible();
  await expect(
    mediaDetailDialog.getByText('Family Movie Fixture', { exact: true }),
  ).toBeVisible();
  await expect(
    mediaDetailDialog.getByText(
      '用于验证移动端和桌面端片单卡片、状态与排期的稳定布局。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    mediaDetailDialog.getByText('周末家庭观影', { exact: true }),
  ).toBeVisible();
  await expect(mediaDetailDialog.getByText('Plex', { exact: true })).toBeVisible();
  await expect(
    mediaDetailDialog.getByRole('link', {
      name: '在详情中用Plex播放家庭电影回归样例',
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await mediaDetailDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('button', {
      name: '补全家庭剧集回归样例的TMDB资料',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: '补全 TMDB 资料', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '手动填写 TMDB ID', exact: true }).click();
  await page.getByLabel('补全 TMDB ID').fill('999002');
  await page.getByRole('button', { name: '保存 TMDB ID', exact: true }).click();
  await expect(page.getByText('补全 TMDB 资料', { exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '订阅家庭剧集回归样例', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '加入片单', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('搜索家庭片单')).toBeVisible();
  await page.getByRole('button', { name: '加入片单', exact: true }).first().click();
  await expect(page.getByText('加入家庭片单', { exact: true })).toBeVisible();
  await expect(page.getByLabel('搜索在线影视')).toBeVisible();
  await page.getByLabel('搜索在线影视').fill('三源搜索样例');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText('豆瓣 1', { exact: true })).toBeVisible();
  await expect(page.getByText('TMDB 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Bangumi 不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择三源搜索候选电影' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-search.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '选择三源搜索候选电影' }).click();
  await expect(page.getByLabel('影视名称')).toBeVisible();
  await expect(page.getByLabel('影视名称')).toHaveValue('三源搜索候选电影');
  await expect(page.getByLabel('豆瓣 ID')).toHaveValue('browser-douban-1');
  await expect(page.getByLabel('安排观影日期')).toBeVisible();
  await page.getByRole('button', { name: '返回影视搜索' }).click();
  await page.getByRole('button', { name: '手动录入', exact: true }).click();
  await expect(page.getByLabel('影视名称')).toHaveValue('');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(page.getByText('加入家庭片单', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: '选片投票', exact: true }).click();
  await page
    .getByRole('checkbox', { name: '选择候选影视家庭电影回归样例' })
    .click();
  await page
    .getByRole('checkbox', { name: '选择候选影视家庭剧集回归样例' })
    .click();
  await expect(page.getByText('已选 2 部', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发起投票', exact: true }).click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(
    page.getByRole('heading', { name: '发起选片投票', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('已选 2 部候选影视', { exact: true })).toBeVisible();
  await expect(page.getByText('家庭电影回归样例', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('家庭剧集回归样例', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '发起投票', exact: true }).last().click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(
    page.getByRole('heading', { name: '观影投票', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: '选择家庭电影回归样例', exact: true })
    .click();
  await page.getByRole('button', { name: '保存选择', exact: true }).click();
  await expect(page.getByText('选择已保存', { exact: true })).toBeVisible();
  await page
    .getByTestId('media-poll-dialog').last()
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: '查看家庭电影回归样例的家庭投票',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(page.getByText('这次一起看哪一部？', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '选择家庭剧集回归样例' }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page
    .getByTestId('media-poll-dialog').last()
    .getByRole('button', { name: '关闭', exact: true })
    .click();

  linkedPollFixture = null;
  mediaFixtureStatus = 'watchlist';
  mediaFixture2Status = 'watchlist';
  await page.goto('/media/watchlist');
  await expect(page.getByRole('heading', { name: '家庭片单', exact: true })).toBeVisible();

  await page
    .getByRole('button', { name: '订阅家庭电影回归样例', exact: true })
    .click();
  await expect(
    page.getByText('提交 MoviePilot 订阅', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '提交订阅', exact: true }).click();
  await expect(page.getByText('订阅处理中', { exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: '取消家庭电影回归样例的MoviePilot订阅',
      exact: true,
    })
    .click();
  await expect(page.getByText('取消 MoviePilot 订阅？', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/MoviePilot 会同时删除匹配的下载任务及其文件/),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消订阅', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('button', { name: '重新订阅家庭电影回归样例', exact: true })
    .click();
  await page.getByRole('button', { name: '提交订阅', exact: true }).click();
  await expect(page.getByText('订阅处理中', { exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: '刷新家庭电影回归样例的MoviePilot订阅状态',
      exact: true,
    })
    .click();
  await expect(page.getByText('订阅完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^想看/ }).click();
  await page
    .getByRole('button', {
      name: '发起家庭电影回归样例的家庭投票',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(
    page.getByRole('heading', { name: '发起观影投票', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('投票标题')).toHaveValue(
    '要一起看《家庭电影回归样例》吗？',
  );
  await expect(page.getByText('想看', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('这次先不看', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发起投票', exact: true }).last().click();
  await expect(page).toHaveURL(/\/media\/watchlist$/);
  await expect(
    page.getByRole('heading', { name: '观影投票', exact: true }),
  ).toBeVisible();
  await page
    .getByTestId('media-poll-dialog').last()
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '投票中 1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: '查看家庭电影回归样例的家庭投票',
      exact: true,
    }),
  ).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByRole('tab')).toHaveCount(4);
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-page.png'),
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回家庭观影', exact: true }).click();
    await expect(page).toHaveURL(/\/media$/);
    await page.getByRole('button', { name: '返回家庭首页', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } else {
    await openSection(page, testInfo.project.name, 'home');
  }
  await page.unroute(mediaAvailabilityRoute);
  await page.unroute(mediaLibraryAddRoute);
  await page.unroute(mediaLibrarySyncRoute);
  await page.unroute(mediaLibraryRoute);
  await page.unroute(mediaConnectorsRoute);
  await page.unroute(mediaConnectorSettingsRoute);
  await page.unroute(mediaSourcesRoute);
  await page.unroute(mediaSearchRoute);
  await page.unroute(mediaRequestActionRoute);
  await page.unroute(mediaSubscribeRoute);
  await page.unroute(mediaRequestsRoute);
  await page.unroute(linkedPollRoute);
  await page.unroute(mediaRoute);

  const tasksLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link').filter({ hasText: '家庭任务' }).first()
      : page.getByRole('link', { name: '家庭任务', exact: true });
  if (testInfo.project.name === 'desktop-chrome' && !(await tasksLink.isVisible())) {
    await page.getByTestId('desktop-nav-group-household').click();
  }
  await expect(tasksLink).toBeVisible();
  await tasksLink.click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('家庭任务', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '添加任务', exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const taskTitle = `任务回归-${testInfo.project.name}`;
  await page.getByRole('button', { name: '添加任务', exact: true }).first().click();
  await expect(page.getByText('新建家庭任务', { exact: true })).toBeVisible();
  await page.getByLabel('任务名称').fill(taskTitle);
  await page.getByLabel('任务备注').fill('浏览器端新增任务');
  await page.getByRole('button', { name: '添加任务', exact: true }).last().click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await openSection(page, testInfo.project.name, 'calendar');
  const calendarTask = page.getByRole('button').filter({ hasText: taskTitle });
  await expect(calendarTask).toBeVisible();
  await calendarTask.click();
  await expect(page).toHaveURL(/\/tasks\?date=.*taskId=/);
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `编辑${taskTitle}` }).click();
  await page.getByLabel('任务备注').fill('浏览器端已编辑任务');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('浏览器端已编辑任务', { exact: true })).toBeVisible();

  await page.getByRole('checkbox', { name: `完成${taskTitle}` }).click();
  await page.getByRole('button', { name: '已处理', exact: true }).click();
  await expect(page.getByRole('button', { name: `恢复${taskTitle}` }).first()).toBeVisible();
  await page.getByRole('button', { name: `恢复${taskTitle}` }).first().click();
  await page.getByRole('button', { name: '待办', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `停用${taskTitle}` }).click();
  await expect(page.getByText('停用这个任务？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停用任务', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `完成${taskTitle}` })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const knowledgeTitle = `浏览器知识文章-${testInfo.project.name}`;
  await page.goto('/knowledge');
  await expect(page.getByText('家庭知识库', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await expect(page.getByText('没有已归档文章', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '使用中', exact: true }).click();
  await page.getByRole('button', { name: '新建知识文章', exact: true }).click();
  await page.getByPlaceholder('文章标题').fill(knowledgeTitle);
  await page.getByPlaceholder('正文内容').fill('隔离浏览器回归创建的非敏感测试正文。');
  await page.getByRole('button', { name: '创建文章', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `打开${knowledgeTitle}`, exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const memoryTitle = `浏览器家庭回忆-${testInfo.project.name}`;
  await page.goto('/memories');
  await expect(page.getByRole('heading', { name: '家庭回忆', exact: true })).toBeVisible();
  const memoryCreate = page.getByRole('button', { name: '新建家庭回忆', exact: true });
  const memoryCreateBox = await memoryCreate.boundingBox();
  expect(memoryCreateBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await memoryCreate.click();
  const memoryForm = page.getByTestId('memory-form-dialog');
  await expect(memoryForm).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(memoryForm.getByTestId('adaptive-dialog-drag-handle')).toBeVisible();
  }
  await memoryForm.getByLabel('标题', { exact: true }).fill(memoryTitle);
  await memoryForm.getByLabel('故事（选填）', { exact: true }).fill('一次隔离浏览器回归留下的非敏感家庭故事。');
  await memoryForm.getByRole('button', { name: '出行', exact: true }).click();
  await memoryForm.getByRole('button', { name: '保存回忆', exact: true }).click();
  const memoryDetail = page.getByTestId('memory-detail-dialog');
  await expect(memoryDetail.getByText(memoryTitle, { exact: true })).toBeVisible();
  await expect(memoryDetail.getByText('一次隔离浏览器回归留下的非敏感家庭故事。', { exact: true })).toBeVisible();
  const [memoryPhotoChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    memoryDetail.getByRole('button', { name: '选择回忆照片', exact: true }).click(),
  ]);
  await memoryPhotoChooser.setFiles({
    name: 'family-memory-browser.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(memoryDetail.getByTestId('memory-photo-preview')).toBeVisible();
  await memoryDetail.getByLabel('照片说明', { exact: true }).fill('浏览器回忆照片');
  await memoryDetail.getByRole('button', { name: '添加照片', exact: true }).click();
  await expect(memoryDetail.getByText('浏览器回忆照片', { exact: true })).toBeVisible();
  await memoryDetail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: `打开回忆${memoryTitle}`, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const travelTitle = `浏览器出行-${testInfo.project.name}`;
  const checklistTitle = `证件袋-${testInfo.project.name}`;
  await page.goto('/travel');
  await expect(page.getByText('家庭出行', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '打包模板', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建模板', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '行程', exact: true }).click();
  await page.getByRole('button', { name: '新建行程', exact: true }).click();
  await page.getByLabel('行程名称', { exact: true }).fill(travelTitle);
  await page.getByLabel('目的地区域', { exact: true }).fill('测试区域');
  await page.getByRole('button', { name: '创建行程', exact: true }).click();
  await expect(page.getByText('行程已创建', { exact: true })).toBeVisible();
  await expect(page.getByText(travelTitle, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByLabel('清单项名称', { exact: true }).fill(checklistTitle);
  await page.getByRole('button', { name: '增加数量', exact: true }).click();
  await page.getByRole('button', { name: '添加清单项', exact: true }).click();
  await expect(page.getByText('清单项已添加', { exact: true })).toBeVisible();
  await page
    .getByRole('checkbox', { name: `完成${checklistTitle}`, exact: true })
    .click();
  await expect(page.getByText('清单项已完成', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  const pollsLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link').filter({ hasText: '家庭投票' }).first()
      : page.getByRole('link', { name: '家庭投票', exact: true });
  await expect(pollsLink).toBeVisible();
  await pollsLink.click();
  await expect(page).toHaveURL(/\/polls$/);
  await expect(page.getByText('家庭投票', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '发起投票', exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const pollTitle = `投票回归-${testInfo.project.name}-${Date.now()}`;
  await page.getByRole('button', { name: '发起投票', exact: true }).first().click();
  await expect(page.getByText('发起家庭投票', { exact: true })).toBeVisible();
  await page.getByLabel('投票标题').fill(pollTitle);
  await page.getByLabel('投票说明').fill('浏览器端新增投票');
  await page.getByRole('textbox', { name: '候选项1', exact: true }).fill('周六上午');
  await page.getByRole('textbox', { name: '候选项2', exact: true }).fill('周日下午');
  await page.getByRole('button', { name: '发起投票', exact: true }).last().click();
  const pollCard = page
    .getByRole('button', { name: `编辑投票${pollTitle}`, exact: true })
    .locator('xpath=ancestor::div[.//*[@role="radio"]][1]');
  await expect(
    pollCard.getByRole('radio', { name: '选择周六上午', exact: true }),
  ).toBeVisible();

  await pollCard
    .getByRole('radio', { name: '选择周六上午', exact: true })
    .click();
  await pollCard.getByRole('button', { name: `提交${pollTitle}的投票` }).click();
  await expect(page.getByText(/1 票 · 100%/).first()).toBeVisible();

  await page.getByRole('button', { name: `编辑投票${pollTitle}` }).click();
  await expect(page.getByText('编辑家庭投票', { exact: true })).toBeVisible();
  await page.getByLabel('投票说明').fill('浏览器端已编辑投票');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('编辑家庭投票', { exact: true })).not.toBeVisible();
  await expect(page.getByText('浏览器端已编辑投票', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: `更多投票操作${pollTitle}` }).click();
  await expect(page.getByTestId('poll-management-dialog')).toBeVisible();
  await page.getByRole('button', { name: `结束投票${pollTitle}` }).click();
  await expect(page.getByText('结束这个投票？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '结束投票', exact: true }).click();
  await page.getByRole('button', { name: '已结束', exact: true }).click();
  await page.getByRole('button', { name: `更多投票操作${pollTitle}` }).click();
  await expect(page.getByRole('button', { name: `重新开启投票${pollTitle}` })).toBeVisible();
  await page.getByRole('button', { name: `重新开启投票${pollTitle}` }).click();
  await page.getByRole('button', { name: '进行中', exact: true }).click();
  await expect(
    pollCard.getByRole('radio', { name: '取消选择周六上午', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: `更多投票操作${pollTitle}` }).click();
  await page.getByRole('button', { name: `删除投票${pollTitle}` }).click();
  await expect(page.getByText('删除这个投票？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除投票', exact: true }).click();
  await expect(page.getByText(pollTitle, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'kitchen');
  await expect(page.getByText('菜单安排', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('本餐主厨', { exact: true })).toHaveCount(3);
  const historyButtons = page.getByRole('button', { name: /操作记录/ });
  await expect(historyButtons).toHaveCount(3);
  await historyButtons.first().click();
  await expect(
    page
      .getByText('暂无记录', { exact: true })
      .or(
        page
          .getByText(
            /点了「|交给|取消了「|更新了「|将本餐主厨设为|清除了本餐主厨|结束并锁定了本餐|认领了「|开始制作「|标记为上桌|恢复了「|划掉了「/,
          )
          .first(),
      ),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'order');
  await expect(page.getByText('点菜', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('搜索菜名')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const recipesLink =
    testInfo.project.name === 'mobile-chrome'
      ? page.getByRole('link', { name: '菜谱', exact: true })
      : page.getByRole('link', { name: '家庭菜谱', exact: true });
  await expect(recipesLink).toBeVisible();
  await recipesLink.click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByText('家庭菜谱', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('搜索菜名、做法或成员')).toBeVisible();
  await expect(page.getByRole('button', { name: '按菜品', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '按成员', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const firstRecipe = page
    .getByRole('link')
    .filter({ hasText: /种做法/ })
    .first();
  await expect(firstRecipe).toBeVisible();
  await firstRecipe.click();
  await expect(page.getByText(/做法版本（\d+）/)).toBeVisible();
  await expect(page.getByText('谁会做', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加我的做法' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'shopping');
  await expect(
    page.getByText('采购与库存', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '家庭库存', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增库存' })).toBeVisible();
  await page.getByRole('button', { name: '新增库存', exact: true }).click();
  await expect(page.getByLabel('搜索关联食材')).toBeVisible();
  await page.getByLabel('搜索关联食材').fill('番茄');
  await page.getByRole('button', { name: '关联食材番茄', exact: true }).click();
  await expect(page.getByLabel('库存名称')).toHaveValue('番茄');
  await expect(page.getByLabel('库存单位')).toHaveValue('个');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'calendar');
  await expect(page.getByText('家庭日历', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '添加事件', exact: true }).first()).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByRole('tab')).toHaveCount(4);
  }
  await expectNoHorizontalOverflow(page);

  const eventTitle = `日历回归-${testInfo.project.name}-${Date.now().toString(36)}`;
  await page.getByRole('button', { name: '添加事件', exact: true }).first().click();
  await expect(page.getByText('新建家庭事件', { exact: true })).toBeVisible();
  await page.getByLabel('事件名称').fill(eventTitle);
  await page.getByLabel('事件备注').fill('浏览器端新增事件');
  await page.getByRole('button', { name: '添加事件', exact: true }).last().click();
  await expect(page.getByRole('button', { name: `编辑${eventTitle}` })).toBeVisible();

  await page.getByRole('button', { name: `编辑${eventTitle}` }).click();
  await page.getByLabel('事件备注').fill('浏览器端已编辑');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByLabel('事件备注')).not.toBeVisible();
  const eventRow = page
    .getByRole('button', { name: `提醒${eventTitle}` })
    .locator('..');
  await expect(eventRow.getByText('浏览器端已编辑', { exact: true })).toBeVisible();

  await eventRow.getByRole('button', { name: `提醒${eventTitle}` }).click();
  await expect(page).toHaveURL(/\/reminders\?sourceModule=calendar&sourceId=/);
  await expect(page.getByText('新建提醒', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: `选择${eventTitle}` }).click();
  await page.getByRole('button', { name: '明天', exact: true }).click();
  await page.getByLabel('提醒时间').fill('18:30');
  const remindDad = page.getByRole('checkbox', { name: '提醒爸爸', exact: true });
  const remindMom = page.getByRole('checkbox', { name: '提醒妈妈', exact: true });
  await expect(remindDad).toHaveAttribute('aria-checked', 'true');
  await remindMom.click();
  await expect(remindMom).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '设置提醒', exact: true }).click();
  await expect(page.getByLabel('提醒时间')).not.toBeVisible();
  const reminderCard = page
    .getByRole('button', { name: `编辑提醒${eventTitle}` })
    .locator('../../..');
  await expect(reminderCard.getByText(eventTitle, { exact: true })).toBeVisible();
  await expect(reminderCard.getByText('爸爸、妈妈', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await reminderCard.getByRole('button', { name: `编辑提醒${eventTitle}` }).click();
  await expect(page.getByText('编辑提醒', { exact: true })).toBeVisible();
  await page.getByLabel('提醒时间').fill('19:00');
  await page.getByRole('button', { name: '保存提醒', exact: true }).click();
  await expect(page.getByLabel('提醒时间')).not.toBeVisible();
  await expect(reminderCard.getByText(/19:00/)).toBeVisible();

  await page.getByRole('button', { name: `取消提醒${eventTitle}` }).click();
  await expect(page.getByText('取消这个提醒？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消提醒', exact: true }).last().click();
  await page.getByRole('button', { name: '已取消', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: eventTitle })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'calendar');

  await page.getByRole('button', { name: `删除${eventTitle}` }).click();
  await expect(page.getByText('删除这个事件？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除事件', exact: true }).click();
  await expect(page.getByRole('button', { name: `编辑${eventTitle}` })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'profile');
  await expect(page.getByText('家庭偏好', { exact: true })).toBeVisible();
  await expect(page.getByText('账号安全', { exact: true })).toBeVisible();
  await expect(page.getByText('成员邀请', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更新密码' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '生成 48 小时邀请' }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: '愿意参与掌勺', exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: '打开家庭成员', exact: true }).click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByText('家庭成员', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '在家成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑爸爸', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑爸爸', exact: true }).click();
  await expect(page.getByText('编辑成员', { exact: true })).toBeVisible();
  await expect(page.getByLabel('成员名称', { exact: true }).last()).toHaveValue('爸爸');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('编辑成员', { exact: true })).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
  } else {
    await openSection(page, testInfo.project.name, 'profile');
  }

  await page.getByRole('link', { name: '打开家庭活动', exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText('家庭活动', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await page.getByRole('button', { name: '菜单', exact: true }).click();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.getByRole('tab')).toHaveCount(4);
  }
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  await expect(
    page.getByText('家庭工作台', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /打开通知中心/ }).first().click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByText('通知中心', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '未读', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openSection(page, testInfo.project.name, 'home');
  await expect(page.getByText('家庭工作台', { exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);

  const accessToken = await page.evaluate(() =>
    window.localStorage.getItem('family-app-token'),
  );
  expect(accessToken).toBeTruthy();
  await openSection(page, testInfo.project.name, 'profile');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByText(/退出账号「爸爸」/)).toBeVisible();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('欢迎回家', { exact: true })).toBeVisible();
  const revoked = await request.get(`${API_URL}/members`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(revoked.status()).toBe(401);
});
