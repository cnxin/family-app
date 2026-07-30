import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'account-media-user-mapping-fixture',
  loginName: 'media-user-mapping-fixture',
  requiresPasswordSetup: false,
};
const sessionMember = {
  id: 'member-media-user-mapping-owner',
  householdId: 'household-media-user-mapping-fixture',
  name: '映射管理员',
  avatarEmoji: 'A',
  role: 'owner',
  prefersCooking: false,
};
const members = [
  {
    ...sessionMember,
    name: '爸爸',
    avatarEmoji: '👨',
  },
  {
    id: 'member-media-user-mapping-mom',
    householdId: sessionMember.householdId,
    name: '妈妈',
    avatarEmoji: '👩',
    role: 'member',
    prefersCooking: false,
  },
];

async function installSession(page: Page) {
  await page.addInitScript(
    ({ accountFixture, memberFixture }) => {
      window.localStorage.setItem('family-app-token', 'media-user-mapping-token');
      window.localStorage.setItem(
        'family-app-refresh-token',
        'media-user-mapping-refresh-token',
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
    { accountFixture: account, memberFixture: sessionMember },
  );
  await page.route(/\/auth\/refresh$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          accessToken: 'media-user-mapping-token-refreshed',
          refreshToken: 'media-user-mapping-refresh-token-refreshed',
          account,
          member: sessionMember,
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

test('Plex 与 Emby 用户可显式映射到家庭成员', async ({ page }, testInfo) => {
  let mapping: { id: string; member: (typeof members)[number] } | null = null;
  let mapRequests = 0;
  let deleteRequests = 0;

  await page.route(/\/notifications(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(/\/members$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: members }),
    });
  });
  await page.route(/\/media\/playback-users$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            connectorKey: 'plex',
            provider: 'plex',
            name: '家庭 Plex',
            state: 'online',
            message: '已读取 2 个用户',
            serverId: 'plex-current-server',
            users: [
              {
                serverId: 'plex-current-server',
                externalUserId: 'plex-user-dad',
                name: '爸爸 Plex',
                isDisabled: false,
                isStale: false,
                mapping: {
                  id: 'mapping-plex-dad',
                  member: members[0],
                },
              },
              {
                serverId: 'plex-current-server',
                externalUserId: 'plex-user-mom',
                name: '妈妈 Plex',
                isDisabled: false,
                isStale: false,
                mapping,
              },
              {
                serverId: 'plex-old-server',
                externalUserId: 'plex-user-old',
                name: '旧服务器账号',
                isDisabled: false,
                isStale: true,
                mapping: {
                  id: 'mapping-plex-old',
                  member: members[1],
                },
              },
            ],
          },
          {
            connectorKey: 'emby',
            provider: 'emby',
            name: 'Emby',
            state: 'offline',
            message: '暂时无法读取用户目录',
            serverId: null,
            users: [
              {
                serverId: 'emby-known-server',
                externalUserId: 'emby-user-mom',
                name: '妈妈 Emby',
                isDisabled: false,
                isStale: false,
                mapping: {
                  id: 'mapping-emby-mom',
                  member: members[1],
                },
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route(
    /\/media\/playback-users\/plex\/plex-user-mom\/mapping$/,
    async (route) => {
      mapRequests += 1;
      expect(route.request().method()).toBe('PUT');
      expect(route.request().postDataJSON()).toEqual({ memberId: members[1].id });
      mapping = { id: 'mapping-plex-mom', member: members[1] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mapping }),
      });
    },
  );
  await page.route(
    /\/media\/playback-user-mappings\/mapping-plex-mom$/,
    async (route) => {
      deleteRequests += 1;
      expect(route.request().method()).toBe('DELETE');
      mapping = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { deleted: true } }),
      });
    },
  );

  await page.goto('/media/settings?section=users');
  await expect(page.getByRole('heading', { name: '观影设置', exact: true })).toBeVisible();
  await expect(page.getByText('家庭 Plex', { exact: true })).toBeVisible();
  await expect(page.getByText('旧服务器账号', { exact: true })).toBeVisible();
  await expect(page.getByText('已失效', { exact: true })).toBeVisible();
  await expect(page.getByText('暂不可验证', { exact: true })).toBeVisible();

  await page.getByLabel('将 妈妈 Plex 关联到 妈妈').click();
  await expect.poll(() => mapRequests).toBe(1);
  await expect(page.getByText('已将 妈妈 Plex 关联到 妈妈', { exact: true })).toBeVisible();
  await expect(page.getByLabel('将 妈妈 Plex 关联到 妈妈')).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.getByLabel('取消 妈妈 Plex 的成员关联').click();
  await expect.poll(() => deleteRequests).toBe(1);
  await expect(page.getByText('已取消 妈妈 Plex 的成员关联', { exact: true })).toBeVisible();
  await expect(page.getByText('妈妈 Plex', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-user-mappings.png'),
    fullPage: true,
  });
});
