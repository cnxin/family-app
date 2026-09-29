import { expect, test } from '@playwright/test';
import { apiClient } from './helpers';

/**
 * 观影设置里两条依赖真媒体服务器的链路：回调地址生成（隔离库没配集成密钥，真接口生成不了）、
 * 播放用户映射（隔离库里 Plex / Emby 都没连）。所以拦 /api/media/... 喂固定数据，
 * 验证页面发出去的请求和页面上给人看的文字。
 */

const INTEGRATION_ID = '55555555-5555-4555-8555-555555555555';
const SECRET = 'e2e-secret-abcdef';

function connector(kind: 'plex' | 'emby' | 'moviepilot', webhookConfigured: boolean) {
  const names = { plex: 'Plex', emby: 'Emby', moviepilot: 'MoviePilot' } as const;
  return {
    kind,
    name: names[kind],
    role: kind === 'moviepilot' ? 'automation' : 'library',
    mode: 'server_default',
    isEnabled: true,
    baseUrl: null,
    credentialConfigured: false,
    credentialHint: null,
    isPrimary: kind === 'plex',
    configured: false,
    capabilities: [],
    webhookConfigured,
    webhookSourceIp: null,
    webhookUpdatedAt: null,
    playbackServerId: null,
    updatedAt: null,
  };
}

test('观影设置（mock）：生成 MoviePilot 和 Plex 回调地址，完整地址只显示这一次', async ({ page }) => {
  const generated = new Set<string>();
  await page.route(
    (url) => url.pathname === '/api/media/connector-settings',
    (route) =>
      route.fulfill({
        json: {
          data: (['plex', 'emby', 'moviepilot'] as const).map((kind) => connector(kind, generated.has(kind))),
        },
      }),
  );
  let moviePilotBody: unknown = null;
  await page.route('**/api/media/connector-settings/moviepilot/webhook', async (route) => {
    moviePilotBody = route.request().postDataJSON();
    generated.add('moviepilot');
    await route.fulfill({
      status: 201,
      json: {
        data: {
          callbackPath: `/media/webhooks/moviepilot/${INTEGRATION_ID}/${SECRET}`,
          sourceIp: '192.168.1.20',
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });
  let plexBody: unknown = null;
  await page.route('**/api/media/connector-settings/plex/playback-webhook', async (route) => {
    plexBody = route.request().postDataJSON();
    generated.add('plex');
    await route.fulfill({
      status: 201,
      json: {
        data: {
          callbackPath: `/media/webhooks/playback/plex/${INTEGRATION_ID}/${SECRET}`,
          sourceIp: '192.168.1.30',
          serverId: 'plex-server-e2e',
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });

  await page.goto('/life/media/settings');
  const origin = new URL(page.url()).origin;

  // MoviePilot：带上允许来源 IP
  await page.getByLabel('MoviePilot 回调允许来源 IP').fill('192.168.1.20');
  const moviePilotRequest = page.waitForRequest('**/api/media/connector-settings/moviepilot/webhook');
  await page.getByRole('button', { name: '生成MoviePilot回调地址' }).click();
  expect((await moviePilotRequest).method()).toBe('POST');
  await expect(page.getByLabel('MoviePilot 回调地址')).toHaveValue(
    `${origin}/api/media/webhooks/moviepilot/${INTEGRATION_ID}/${SECRET}`,
  );
  expect(moviePilotBody).toEqual({ sourceIp: '192.168.1.20' });
  await expect(page.locator('main [aria-live="polite"]')).toHaveText('已生成回调地址');
  // 列表刷新之后变成「已启用」，但刚生成的完整地址不能被顶掉
  await expect(page.getByRole('button', { name: '重新生成MoviePilot回调地址' })).toBeVisible();
  await expect(page.getByLabel('MoviePilot 回调地址')).toHaveValue(
    `${origin}/api/media/webhooks/moviepilot/${INTEGRATION_ID}/${SECRET}`,
  );

  // Plex：不填来源 IP，请求体里就不带这个字段
  await page.getByRole('button', { name: '生成Plex回调地址' }).click();
  await expect(page.getByLabel('Plex 回调地址')).toHaveValue(
    `${origin}/api/media/webhooks/playback/plex/${INTEGRATION_ID}/${SECRET}`,
  );
  expect(plexBody).toEqual({});
  // 后端回传的来源 IP 回填到输入框
  await expect(page.getByLabel('Plex 回调允许来源 IP')).toHaveValue('192.168.1.30');
});

test('观影设置（mock）：用户映射——在线账号可关联和取消，失效与离线账号只能取消', async ({ page, request }) => {
  const mom = apiClient(request, '妈妈');
  const dad = apiClient(request);
  const momId = mom.memberId;
  const dadMember = { id: dad.memberId, name: '爸爸', avatarEmoji: '👨', disabledAt: null };
  const MAPPING_ID = '66666666-6666-4666-8666-666666666666';
  let onlineMapping: { id: string; member: unknown } | null = null;

  await page.route('**/api/media/playback-users', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            connectorKey: 'plex',
            provider: 'plex',
            name: '客厅 Plex',
            state: 'online',
            message: '已连接到客厅 Plex',
            serverId: 'plex-server-e2e',
            users: [
              {
                serverId: 'plex-server-e2e',
                externalUserId: 'plex-user-1',
                name: 'e2e 在线账号',
                isDisabled: false,
                isStale: false,
                mapping: onlineMapping,
              },
              {
                serverId: 'plex-server-e2e',
                externalUserId: 'plex-user-2',
                name: 'e2e 失效账号',
                isDisabled: false,
                isStale: true,
                mapping: { id: '77777777-7777-4777-8777-777777777777', member: dadMember },
              },
            ],
          },
          {
            connectorKey: 'emby',
            provider: 'emby',
            name: '书房 Emby',
            state: 'offline',
            message: 'e2e：书房 Emby 连不上',
            serverId: null,
            users: [
              {
                serverId: null,
                externalUserId: 'emby-user-1',
                name: 'e2e 离线账号',
                isDisabled: false,
                isStale: false,
                mapping: null,
              },
            ],
          },
        ],
      },
    }),
  );
  let mappedBody: unknown = null;
  await page.route('**/api/media/playback-users/plex/plex-user-1/mapping', async (route) => {
    mappedBody = route.request().postDataJSON();
    onlineMapping = { id: MAPPING_ID, member: { id: momId, name: '妈妈', avatarEmoji: '👩', disabledAt: null } };
    await route.fulfill({ json: { data: { id: MAPPING_ID } } });
  });
  let unmapped = false;
  await page.route(`**/api/media/playback-user-mappings/${MAPPING_ID}`, async (route) => {
    unmapped = route.request().method() === 'DELETE';
    onlineMapping = null;
    await route.fulfill({ json: { data: { deleted: true } } });
  });

  await page.goto('/life/media/settings?section=users');
  await expect(page.getByRole('heading', { name: '观影设置', level: 1 })).toBeVisible();

  // 卡头：服务状态 + 后端给的原因
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  await expect(page.getByText('连不上', { exact: true })).toBeVisible();
  await expect(page.getByText('e2e：书房 Emby 连不上')).toBeVisible();

  // 失效账号：标「已失效」，没有下拉，只留「取消关联」
  const stale = page.getByRole('article', { name: '客厅 Plex 用户 e2e 失效账号' });
  await expect(stale).toContainText('已失效');
  await expect(stale).toContainText('爸爸');
  await expect(stale.getByRole('combobox')).toHaveCount(0);
  await expect(stale.getByRole('button', { name: '取消 e2e 失效账号 的成员关联' })).toBeVisible();

  // 离线服务上的账号：标「暂不可验证」，没关联过就什么都不能点
  const offline = page.getByRole('article', { name: '书房 Emby 用户 e2e 离线账号' });
  await expect(offline).toContainText('暂不可验证');
  await expect(offline).toContainText('未关联');
  await expect(offline.getByRole('combobox')).toHaveCount(0);
  await expect(offline.getByRole('button')).toHaveCount(0);

  // 在线账号：选成员 → PUT mapping {memberId}
  const online = page.getByRole('article', { name: '客厅 Plex 用户 e2e 在线账号' });
  const select = online.getByRole('combobox', { name: 'e2e 在线账号 对应的家庭成员' });
  // 等响应而不是请求：request 事件可能先于 route 回调到达，那时回调里记的变量还没写
  const mapResponse = page.waitForResponse('**/api/media/playback-users/plex/plex-user-1/mapping');
  await select.selectOption(momId);
  expect((await mapResponse).request().method()).toBe('PUT');
  expect(mappedBody).toEqual({ memberId: momId });
  await expect(page.locator('main [aria-live="polite"]')).toHaveText('已把 e2e 在线账号 关联到 妈妈');
  await expect(page.getByRole('alert').filter({ hasText: '已把 e2e 在线账号 关联到 妈妈' })).toBeVisible();
  await expect(select).toHaveValue(momId);

  // 选回「未关联」→ DELETE 那条映射
  const unmapResponse = page.waitForResponse(`**/api/media/playback-user-mappings/${MAPPING_ID}`);
  await select.selectOption('');
  expect((await unmapResponse).request().method()).toBe('DELETE');
  expect(unmapped).toBe(true);
  await expect(page.locator('main [aria-live="polite"]')).toHaveText('已取消 e2e 在线账号 的成员关联');
  await expect(select).toHaveValue('');
});
