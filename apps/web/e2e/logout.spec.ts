import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiClient, apiURL, stamp } from './helpers';

interface FreshSession {
  accessToken: string;
  refreshToken: string;
  member: { id: string; name: string };
}

// 退出会吊销会话，不能用 setup 存下的共享令牌：邀请 + 兑换现开一个成员和会话，不走登录接口。
test.use({ storageState: { cookies: [], origins: [] } });

test('退出登录会让服务端吊销会话：旧访问令牌和刷新令牌都不再好使', async ({ page, request }) => {
  const admin = apiClient(request);
  const invitation = await admin.post<{ invitationToken: string }>('/household/invitations', {
    memberName: stamp('退出测试'),
    role: 'member',
    expiresInHours: 1,
  });
  const redeemed = await request.post(`${apiURL}/auth/invitations/redeem`, {
    data: {
      invitationToken: invitation.invitationToken,
      loginName: `logout-${randomUUID().slice(0, 8)}`,
      password: 'logout-pass-1234',
    },
  });
  expect(redeemed.status()).toBe(201);
  const session = ((await redeemed.json()) as { data: FreshSession }).data;

  try {
    await page.addInitScript((value) => {
      if (!sessionStorage.getItem('e2e.seeded')) {
        localStorage.setItem('family-app.session', value);
        sessionStorage.setItem('e2e.seeded', '1');
      }
    }, JSON.stringify(session));
    await page.goto('/me/profile');
    await page.getByRole('button', { name: '退出登录' }).click();
    const dialog = page.getByRole('dialog', { name: '退出登录？' });
    const logout = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/auth/logout'),
    );
    await dialog.getByRole('button', { name: '退出登录' }).click();
    expect((await logout).status()).toBe(200);

    await expect(page.getByPlaceholder('输入账号')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('family-app.session'))).toBeNull();

    const withOldAccess = await request.get(`${apiURL}/members`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(withOldAccess.status()).toBe(401);
    const withOldRefresh = await request.post(`${apiURL}/auth/refresh`, {
      data: { refreshToken: session.refreshToken },
    });
    expect(withOldRefresh.status()).toBe(401);
  } finally {
    await admin.patch(`/household/members/${session.member.id}/status`, { enabled: false });
  }
});
