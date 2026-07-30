import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('媒体库可同步、播放并加入家庭片单', async ({ page }, testInfo) => {
  let householdMediaId: string | null = null;
  const libraryRoute = /\/media\/library(?:\?.*)?$/;
  const syncRoute = /\/media\/library\/sync$/;
  const addRoute = /\/media\/library\/library-focused-fixture\/add$/;

  await page.route(libraryRoute, async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [
            {
              id: 'library-focused-fixture',
              connectorKey: 'plex',
              provider: 'plex',
              connectorName: 'Plex',
              libraryItemId: '242',
              type: 'movie',
              title: '媒体库聚焦回归',
              originalTitle: 'Focused Library Regression',
              year: 2099,
              overview: '验证媒体库同步、播放入口与家庭片单导入。',
              posterUrl: null,
              externalRefs: [
                { provider: 'tmdb', mediaType: 'movie', externalId: '550' },
                { provider: 'imdb', mediaType: 'movie', externalId: 'tt0137523' },
              ],
              playbackUrl: 'http://plex.test/web/index.html#!/details?key=242',
              householdMediaId,
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
  await page.route(syncRoute, async (route) => {
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
  await page.route(addRoute, async (route) => {
    expect(route.request().method()).toBe('POST');
    householdMediaId = 'media-focused-fixture';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { householdMediaId, added: true },
      }),
    });
  });

  await page.goto('/media/library');
  await expect(page.getByRole('heading', { name: '我的媒体库' })).toBeVisible();
  await expect(page.getByText('媒体库聚焦回归', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '用Plex播放媒体库聚焦回归' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '同步媒体库' }).click();
  await expect(
    page.getByText('已同步 1 部，关联家庭片单 0 部', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '将媒体库聚焦回归加入家庭片单' })
    .click();
  await expect(page.getByText('已在片单', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('media-library-focused.png'),
    fullPage: true,
  });
});
