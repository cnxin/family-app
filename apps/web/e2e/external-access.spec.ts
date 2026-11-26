import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  apiClient,
  apiURL,
  expectNoHorizontalOverflow,
  freshMemberSession,
  seedSession,
  watchPageErrors,
} from './helpers';

// M5-E 外部访问 E2E：真隔离 API + 假 Tailscale 控制面（apps/api/scripts/fake-tailscale.mjs）。
interface FakeTailscale {
  url: string;
  mode: 'ok' | 'error' | 'timeout' | 'redirect';
  credentials: {
    oauthClientId: string;
    oauthClientSecret: string;
    rwOauthClientId: string;
    rwOauthClientSecret: string;
    apiToken: string;
    rwApiToken: string;
  };
  stop(): Promise<void>;
}

const FAKE_TAILSCALE_MODULE = new URL('../../api/scripts/fake-tailscale.mjs', import.meta.url).href;
async function startFakeTailscale(): Promise<FakeTailscale> {
  const mod = (await import(FAKE_TAILSCALE_MODULE)) as {
    startFakeTailscale(): Promise<FakeTailscale>;
  };
  return mod.startFakeTailscale();
}

async function cleanExternalAccess(request: APIRequestContext) {
  const admin = apiClient(request);
  const headers = { Authorization: `Bearer ${admin.accessToken}` };
  await request.delete(`${apiURL}/external-access/settings`, { headers });
}

let fake: FakeTailscale | undefined;

test.beforeEach(async ({ request }) => {
  fake = await startFakeTailscale();
  await cleanExternalAccess(request);
});

test.afterEach(async ({ request }) => {
  try {
    await cleanExternalAccess(request);
  } finally {
    await fake?.stop();
    fake = undefined;
  }
});

test('管理员配置只读 OAuth、拦截读写凭据、查看节点/二维码/设备详情、故障降级与恢复默认', async ({
  page,
}) => {
  const pageErrors = watchPageErrors(page);

  await page.goto('/house/external-access');
  await expect(page.getByText('还没接入 Tailscale 控制面', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: '去配置外部访问' }).click();
  await expect(page).toHaveURL(/\/house\/external-access\/settings$/);

  // 展开高级设置填入本地 mock 控制面地址
  await page.locator('summary').filter({ hasText: '高级设置' }).click();
  await page.getByLabel('控制面 API 地址').fill(fake!.url);

  // 1) 读写 OAuth 客户端：测试连接提示「含写权限（阶段 1 禁止）」，保存亦被拒绝
  await page.getByLabel('Tailscale OAuth Client ID').fill(fake!.credentials.rwOauthClientId);
  await page.getByLabel('Tailscale OAuth Client Secret').fill(fake!.credentials.rwOauthClientSecret);
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText('含写权限（阶段 1 禁止）')).toBeVisible();
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.getByText(/写权限|只读/).first()).toBeVisible();

  // 2) 填入只读 OAuth 客户端与外部访问地址，保存并测试
  await page.getByLabel('Tailscale OAuth Client ID').fill(fake!.credentials.oauthClientId);
  await page.getByLabel('Tailscale OAuth Client Secret').fill(fake!.credentials.oauthClientSecret);
  await page.getByLabel('小管家节点名').fill('xiaoguanjia');
  await page.getByLabel('外部访问地址').fill('https://xiaoguanjia.family.ts.net');
  await page.getByRole('button', { name: '保存并测试' }).click();

  await expect(page.getByText('只读权限已核验', { exact: true })).toBeVisible();
  await expect(page.getByText('发现 4 台设备 · 已匹配节点 xiaoguanjia.family.ts.net')).toBeVisible();
  await expect(page.getByText('kTes…t001')).toBeVisible();
  await expect(page.getByText(`****${fake!.credentials.oauthClientSecret.slice(-4)}`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(fake!.credentials.oauthClientSecret);
  await expectNoHorizontalOverflow(page);

  // 3) 家里页出现外部访问入口并跳转概览
  await page.goto('/home');
  const tile = page.locator('[data-home-grid]').getByRole('link', { name: '外部访问', exact: true });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page).toHaveURL(/\/house\/external-access$/);

  await expect(page.locator('[data-external-access-connection="ok"]')).toBeVisible();
  await expect(page.getByText('xiaoguanjia.family.ts.net').first()).toBeVisible();
  await expect(page.getByText('https://xiaoguanjia.family.ts.net')).toBeVisible();

  // 展开二维码与筛选设备
  await page.getByRole('button', { name: '显示二维码' }).click();
  await expect(page.getByRole('img', { name: /外部访问地址 .* 的二维码/ })).toBeVisible();

  await page.getByRole('tab', { name: '需留意' }).click();
  await expect(page.locator('[data-external-access-device]')).toHaveCount(3);
  await page.getByRole('tab', { name: '全部' }).click();
  await expect(page.locator('[data-external-access-device]')).toHaveCount(4);

  // 点开单台设备明细，校验 Tailscale 地址、ACL 标签且不含敏感底层字段
  await page.locator('[data-external-access-device="dev-server-1"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('100.64.0.10')).toBeVisible();
  await expect(dialog.getByText('tag:server')).toBeVisible();
  await expect(dialog).not.toContainText('must-never-leak');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
  await expectNoHorizontalOverflow(page);

  // 4) 控制面故障时降级提示，其它页面不受影响
  fake!.mode = 'error';
  await page.getByRole('button', { name: '刷新' }).click();
  await expect(page.locator('[data-external-access-connection="down"]')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '连不上 Tailscale 控制面' })).toBeVisible();

  await page.goto('/house/shopping');
  await expect(page.getByRole('heading', { name: '购物清单' })).toBeVisible();
  await expect(page.getByText('连不上 Tailscale 控制面')).toHaveCount(0);

  // 5) 恢复默认设置
  fake!.mode = 'ok';
  await page.goto('/house/external-access/settings');
  await page.getByRole('button', { name: '恢复外部访问默认设置' }).click();
  await page.getByRole('button', { name: '确认恢复' }).click();
  await expect(page.getByText('已清除家庭覆盖，恢复服务器默认设置')).toBeVisible();
  await expect(page.getByText('服务器默认', { exact: true })).toBeVisible();

  // 6) 管理员个人页经外部通道时显示横幅与 Tailscale 登录账号
  await page.route('**/api/external-access/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { viaTailscale: true, login: 'dad@example.com', name: 'Dad' },
      }),
    }),
  );
  await page.goto('/profile');
  const adminBadge = page.locator('[data-external-access-session="tailscale"]');
  await expect(adminBadge).toBeVisible();
  await expect(adminBadge).toContainText('正在通过外部通道访问');
  await expect(adminBadge).toContainText('dad@example.com');

  expect(pageErrors).toEqual([]);
});

test('普通成员无法访问外部访问概览与设置页，个人页外部通道标识隐藏登录名', async ({ browser, page, request }) => {
  const admin = apiClient(request);
  await admin.put('/external-access/settings', {
    baseUrl: fake!.url,
    tailnet: '-',
    nodeHostname: 'xiaoguanjia',
    publicUrl: 'https://xiaoguanjia.family.ts.net',
    credentialKind: 'oauth_client',
    oauthClientId: fake!.credentials.oauthClientId,
    credential: fake!.credentials.oauthClientSecret,
  });

  const member = await freshMemberSession(request, '外部访问家人');
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  const memberPage = await context.newPage();
  await seedSession(memberPage, member);
  try {
    const pageErrors = watchPageErrors(memberPage);
    await memberPage.goto('/house/external-access');
    await expect(memberPage.getByText('这一页只有家庭管理员能看')).toBeVisible();
    await expect(memberPage.locator('body')).not.toContainText('xiaoguanjia.family.ts.net');

    await memberPage.goto('/house/external-access/settings');
    await expect(memberPage.getByText('这一页只有家庭管理员能改')).toBeVisible();

    await memberPage.route('**/api/external-access/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { viaTailscale: true, login: null, name: null },
        }),
      }),
    );
    await memberPage.goto('/profile');
    await expect(memberPage.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
    const memberBadge = memberPage.locator('[data-external-access-session="tailscale"]');
    await expect(memberBadge).toBeVisible();
    await expect(memberBadge).toContainText('正在通过外部通道访问');
    await expect(memberBadge).not.toContainText('@');
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await admin.patch(`/household/members/${member.member.id}/status`, { enabled: false });
  }
});
