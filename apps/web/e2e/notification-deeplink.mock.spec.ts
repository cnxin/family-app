import { expect, test } from '@playwright/test';
import { apiClient, stamp } from './helpers';

/**
 * 后端写进通知的 targetPath 还是旧客户端的一层路径（`/media/watchlist?mediaId=…`）。
 * 点一条通知要做三件事：标已读、翻译成新路径跳过去、落地页按 mediaId 打开那一条。
 * 隔离库里凑不出一条「片单」通知，所以通知列表和标已读用 mock，片单条目是真建的。
 */
test('消息（mock）：点一条片单通知，标已读并跳到新片单页、直接打开那一条', async ({ page, request }) => {
  const api = apiClient(request);
  const title = stamp('通知片');
  const media = await api.post<{ id: string }>('/media', { type: 'movie', title });
  const notificationId = '88888888-8888-4888-8888-888888888888';
  const notificationTitle = `e2e：片单里多了「${title}」`;
  let readAt: string | null = null;
  const notification = () => ({
    id: notificationId,
    householdId: '99999999-9999-4999-8999-999999999999',
    recipientId: api.memberId,
    recipient: { id: api.memberId, name: '爸爸', avatarEmoji: '👨', role: 'admin' },
    module: 'media',
    type: 'media_added',
    sourceId: media.id,
    title: notificationTitle,
    body: '点开看看要不要排期',
    targetPath: `/media/watchlist?mediaId=${media.id}`,
    readAt,
    createdAt: new Date().toISOString(),
  });

  try {
    await page.route(
      (url) => url.pathname === '/api/notifications',
      (route) => {
        const includeRead = new URL(route.request().url()).searchParams.get('includeRead') === 'true';
        const rows = includeRead || !readAt ? [notification()] : [];
        return route.fulfill({ json: { data: rows } });
      },
    );
    let readMethod: string | null = null;
    await page.route(`**/api/notifications/${notificationId}/read`, async (route) => {
      readMethod = route.request().method();
      readAt = new Date().toISOString();
      await route.fulfill({ json: { data: notification() } });
    });

    await page.goto('/schedule/notifications');
    await expect(page.locator('main').getByText('1 条未读', { exact: true })).toBeVisible();
    const readRequest = page.waitForRequest(`**/api/notifications/${notificationId}/read`);
    await page.getByRole('button', { name: new RegExp(`^${notificationTitle}`) }).click();
    await readRequest;
    expect(readMethod).toBe('PATCH');

    // 旧路径翻成新路径；片单页读到 mediaId 之后把参数抹掉，并打开这一条的编辑框
    await expect(page.getByRole('dialog', { name: `编辑「${title}」的安排` })).toBeVisible();
    await expect(page).toHaveURL(/\/life\/media\/watchlist$/);
    await expect(page.locator('main h1')).toHaveText('家庭片单');
  } finally {
    await api.delete(`/media/${media.id}`);
  }
});
