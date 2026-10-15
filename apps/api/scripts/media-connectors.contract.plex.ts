import { PlexLibraryProvider } from '../src/media/connectors.plex';
import {
  assert,
  json,
  config,
  references,
  seriesReferences,
} from './media-connectors.contract.helpers';

export async function testPlex() {
  const requests: URL[] = [];
  const provider = new PlexLibraryProvider(
    config('plex'),
    (async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert(
        new Headers(init?.headers).get('X-Plex-Token') === 'contract-secret',
        'Plex Token 只通过请求头发送',
      );
      if (url.pathname === '/identity') {
        return json({
          MediaContainer: {
            machineIdentifier: 'plex-server-id',
            version: '1.43.0',
          },
        });
      }
      if (url.pathname === '/library/sections') {
        return json({
          MediaContainer: {
            Directory: [
              { key: '1', type: 'movie', title: '电影' },
              { key: '2', type: 'show', title: '剧集' },
            ],
          },
        });
      }
      if (url.pathname === '/accounts') {
        return json({
          MediaContainer: {
            Account: [
              { id: 1, name: '爸爸 Plex' },
              { id: 2, name: '妈妈 Plex' },
            ],
          },
        });
      }
      if (url.pathname === '/library/sections/1/all') {
        return json({
          MediaContainer: {
            totalSize: 1,
            Metadata: [
              {
                ratingKey: '242',
                type: 'movie',
                title: 'Fight Club',
                year: 1999,
                summary: 'An insomniac meets a soap maker.',
                thumb: '/library/metadata/242/thumb/poster-tag',
                Guid: [
                  { id: 'tmdb://550' },
                  { id: 'imdb://tt0137523' },
                ],
              },
            ],
          },
        });
      }
      if (url.pathname === '/library/sections/2/all') {
        return json({ MediaContainer: { totalSize: 0, Metadata: [] } });
      }
      if (url.pathname === '/library/metadata/242/thumb/poster-tag') {
        return new Response('plex-poster', {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (url.pathname === '/library/metadata/series-1/children') {
        return json({
          MediaContainer: {
            Metadata: [
              { type: 'season', index: 1, leafCount: 12 },
              { type: 'season', index: 2, leafCount: 10 },
            ],
          },
        });
      }
      if (url.pathname === '/library/all') {
        if (url.searchParams.get('guid') === 'tmdb://1399') {
          return json({
            MediaContainer: {
              Metadata: [
                {
                  ratingKey: 'series-1',
                  type: 'show',
                  title: 'Game of Thrones',
                  Guid: [{ id: 'tmdb://1399' }],
                },
              ],
            },
          });
        }
        return json({
          MediaContainer: {
            Metadata: [
              {
                ratingKey: '242',
                type: 'movie',
                title: 'Fight Club',
                year: 1999,
                Guid: [
                  { id: 'tmdb://550' },
                  { id: 'imdb://tt0137523' },
                ],
              },
            ],
          },
        });
      }
      return json({}, 404);
    }) as typeof fetch,
  );
  const health = await provider.health();
  const users = await provider.listUsers();
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
  const seriesMatches = await provider.findByExternalRefs(seriesReferences, {
    seasons: [2],
  });
  const poster = await provider.getPoster('242', library[0].metadata);
  const requestCount = requests.length;
  const untrustedPoster = await provider.getPoster('242', {
    thumb: '//untrusted.test/poster.jpg',
  });
  assert(health.available && health.message === 'Plex 1.43.0', '读取 Plex 版本');
  assert(
    users.serverId === 'plex-server-id' &&
      users.users.map((user) => user.externalUserId).join(',') === '1,2',
    '读取 Plex 稳定服务器标识和用户目录',
  );
  assert(matches.length === 1 && matches[0].libraryItemId === '242', '按外部 ID 匹配 Plex 条目');
  assert(
    seriesMatches[0]?.seasons[0]?.season === 2 &&
      seriesMatches[0]?.seasons[0]?.episodeCount === 10,
    'Plex 只返回请求季的已发现集数',
  );
  assert(
    library.length === 1 &&
      library[0].title === 'Fight Club' &&
      library[0].externalRefs.some((ref) => ref.provider === 'tmdb'),
    '分页读取 Plex 媒体库及外部编号',
  );
  assert(
    matches[0].playbackUrl?.includes('/server/plex-server-id/details?key=') &&
      !matches[0].playbackUrl.includes('contract-secret') &&
      !requests.some((url) => url.search.includes('contract-secret')),
    'Plex 播放链接和查询参数不泄露 Token',
  );
  assert(
    poster?.contentType === 'image/jpeg' &&
      poster.body.toString() === 'plex-poster' &&
      !requests.some((url) => url.search.includes('contract-secret')),
    '通过请求头安全读取 Plex 海报',
  );
  assert(
    untrustedPoster === null && requests.length === requestCount,
    'Plex 海报代理拒绝跨服务器图片路径',
  );
}
