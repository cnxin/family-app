import { expect, test } from '@playwright/test';

/**
 * 片库依赖 Plex / Emby，隔离库里是空配置，所以这一页的回归用 mock：
 * 拦住 /api/media/library*，喂一条固定数据，验证海报（后端签名的相对地址）、
 * 加片单之后按钮变「已在片单」这两条真正容易坏的链路。
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const POSTER_PATH = `/media/library/${ITEM_ID}/poster?expires=4070908800&signature=test`;

test('片库（mock）：海报能出来，加片单之后按钮变成已在片单', async ({ page }) => {
  let householdMediaId: string | null = null;
  let posterRequested = false;

  await page.route('**/api/media/library?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [
            {
              id: ITEM_ID,
              connectorKey: 'plex',
              provider: 'plex',
              connectorName: '客厅 Plex',
              libraryItemId: 'plex-1',
              type: 'movie',
              title: 'e2e 测试片',
              originalTitle: 'E2E Test Feature',
              year: 2099,
              overview: '给片库页做回归用的假数据。',
              posterUrl: POSTER_PATH,
              externalRefs: [{ provider: 'tmdb', mediaType: 'movie', externalId: '550' }],
              playbackUrl: 'http://plex.test/web/index.html#!/server/x/details?key=1',
              householdMediaId,
              lastSeenAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 24,
          pages: 1,
          lastSyncedAt: new Date().toISOString(),
          connectors: [
            { connectorKey: 'plex', name: '客厅 Plex', provider: 'plex', lastSyncedAt: new Date().toISOString() },
          ],
        },
      }),
    });
  });

  await page.route(`**/api${POSTER_PATH.split('?')[0]}**`, async (route) => {
    posterRequested = true;
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });

  await page.route(`**/api/media/library/${ITEM_ID}/add`, async (route) => {
    householdMediaId = '22222222-2222-4222-8222-222222222222';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { householdMediaId, added: true } }),
    });
  });

  await page.goto('/eat/media/library');
  await expect(page.getByRole('heading', { name: '我的媒体库', level: 1 })).toBeVisible();

  const card = page.getByRole('article', { name: 'e2e 测试片' });
  await expect(card).toContainText('电影');
  await expect(card).toContainText('客厅 Plex');
  await expect.poll(() => posterRequested, { message: '海报应该按签名地址去取一次' }).toBe(true);

  // 详情弹窗里外部编号和原名都在
  await card.getByRole('button', { name: '看看e2e 测试片' }).click();
  const detail = page.getByRole('dialog', { name: 'e2e 测试片' });
  await expect(detail).toContainText('E2E Test Feature');
  await expect(detail).toContainText('TMDB 550');
  await detail.getByRole('button', { name: '关闭' }).click();

  // 加进片单之后，列表重取，按钮变「已在片单」
  await card.getByRole('button', { name: '把e2e 测试片加进片单' }).click();
  await expect(card.getByRole('link', { name: '已在片单' })).toBeVisible();
});
