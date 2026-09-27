import { expect, test } from '@playwright/test';
import { apiClient, freshMemberSession, seedSession, type FreshSession } from './helpers';

// 续期会轮换刷新令牌，不能拿 setup 存下的共享会话来试：邀请 + 兑换现开一个成员和会话。
test.use({ storageState: { cookies: [], origins: [] } });

test('访问令牌过期（401）时客户端只续期一次，然后照常把任务列表画出来', async ({ page, request }) => {
  const admin = apiClient(request);
  const session = await freshMemberSession(request, '续期测试');

  try {
    await seedSession(page, session);

    // 第一次取任务假装令牌过期；之后的请求放行给真 API
    let rejected = 0;
    await page.route(
      (url) => url.pathname === '/api/tasks',
      async (route) => {
        if (route.request().method() === 'GET' && rejected === 0) {
          rejected += 1;
          await route.fulfill({
            status: 401,
            json: { error: { code: 'UNAUTHORIZED', message: '登录已过期' } },
          });
          return;
        }
        await route.continue();
      },
    );
    const refreshes: number[] = [];
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/refresh') {
        refreshes.push(response.status());
      }
    });
    const retried = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/tasks' &&
        response.status() === 200,
    );

    await page.goto('/schedule/tasks');
    await retried;
    await expect(page.locator('main h1')).toHaveText('家庭任务');
    await expect(page.getByPlaceholder('加一件今天要做的事')).toBeVisible();
    await expect(page.getByPlaceholder('输入账号')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    expect(rejected, '应该真的拦下了一次任务请求').toBe(1);
    expect(refreshes, '只续期一次，并且续期成功').toEqual([200]);
    // 续期后的新令牌写回了本地会话
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('family-app.session'))) ?? 'null') as
      | FreshSession
      | null;
    expect(stored?.member.id).toBe(session.member.id);
    expect(stored?.refreshToken).not.toBe(session.refreshToken);
  } finally {
    await admin.patch(`/household/members/${session.member.id}/status`, { enabled: false });
  }
});
