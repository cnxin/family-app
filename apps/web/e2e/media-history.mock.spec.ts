import { expect, test } from '@playwright/test';

/** 观看记录靠 Plex / Emby 的播放 webhook 喂数据，隔离库里没有，所以也用 mock。 */
test('观看记录（mock）：进度条、参与的人、接着看的入口', async ({ page }) => {
  await page.route('**/api/media/viewing-sessions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            provider: 'plex',
            connectorName: '客厅 Plex',
            mediaLibraryItemId: null,
            mediaTitleId: null,
            libraryItemId: 'plex-1',
            contentItemId: 'plex-1',
            mediaType: 'movie',
            title: 'e2e 正在放的片',
            deviceName: '客厅电视',
            status: 'active',
            positionMs: 1_800_000,
            durationMs: 5_400_000,
            percentage: 33.3,
            startedAt: new Date().toISOString(),
            endedAt: null,
            lastEventAt: new Date().toISOString(),
            posterUrl: null,
            playbackUrl: 'http://plex.test/web/index.html',
            participants: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                member: { id: 'm1', name: '爸爸', avatarEmoji: '👨' },
                joinedAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto('/eat/media/history');
  await expect(page.getByRole('heading', { name: '观看记录', level: 1 })).toBeVisible();

  const card = page.getByRole('article', { name: 'e2e 正在放的片' });
  await expect(card).toContainText('正在放');
  await expect(card).toContainText('客厅电视');
  await expect(card).toContainText('爸爸');
  await expect(card).toContainText('看到 30 分钟 / 1 小时 30 分');
  await expect(card.getByRole('link', { name: '用客厅 Plex打开e2e 正在放的片' })).toBeVisible();

  // 「放完了」这一档里不该有它
  await page.getByRole('tab', { name: '放完了' }).click();
  await expect(card).toBeHidden();
});
