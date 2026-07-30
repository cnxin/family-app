import {
  EmbyLibraryProvider,
  MoviePilotAutomationProvider,
  PlexLibraryProvider,
} from '../src/media/connectors';
import { MediaConnectorConfig } from '../src/media/connectors.config';
import { MediaMetadataSnapshot } from '../src/media/providers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function config(
  kind: MediaConnectorConfig['kind'],
  credential = 'contract-secret',
): MediaConnectorConfig {
  return {
    key: kind,
    kind,
    name: kind === 'moviepilot' ? 'MoviePilot' : kind === 'plex' ? 'Plex' : 'Emby',
    baseUrl: `http://${kind}.test`,
    credential,
    primary: kind === 'plex',
  };
}

const references = [
  { provider: 'tmdb' as const, mediaType: 'movie' as const, externalId: '550' },
  { provider: 'imdb' as const, mediaType: 'movie' as const, externalId: 'tt0137523' },
];

async function testPlex() {
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
            Directory: [{ key: '1', type: 'movie', title: '电影' }],
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
      if (url.pathname === '/library/metadata/242/thumb/poster-tag') {
        return new Response('plex-poster', {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (url.pathname === '/library/all') {
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
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
  const poster = await provider.getPoster('242', library[0].metadata);
  const requestCount = requests.length;
  const untrustedPoster = await provider.getPoster('242', {
    thumb: '//untrusted.test/poster.jpg',
  });
  assert(health.available && health.message === 'Plex 1.43.0', '读取 Plex 版本');
  assert(matches.length === 1 && matches[0].libraryItemId === '242', '按外部 ID 匹配 Plex 条目');
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

async function testEmby() {
  const requests: URL[] = [];
  const provider = new EmbyLibraryProvider(
    config('emby'),
    (async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert(
        new Headers(init?.headers).get('X-Emby-Token') === 'contract-secret',
        'Emby API Key 只通过请求头发送',
      );
      if (url.pathname === '/System/Info') {
        return json({ Id: 'emby-server-id', Version: '4.9.1' });
      }
      if (url.pathname === '/Items') {
        if (url.searchParams.has('AnyProviderIdEquals')) {
          assert(
            url.searchParams.get('AnyProviderIdEquals')?.includes('Tmdb.550'),
            '使用 TMDB ProviderId 查询 Emby',
          );
        }
        return json({
          TotalRecordCount: 1,
          Items: [
            {
              Id: 'emby-item-7',
              Type: 'Movie',
              Name: 'Fight Club',
              ProductionYear: 1999,
              ProviderIds: { Tmdb: '550', Imdb: 'tt0137523' },
              ImageTags: { Primary: 'emby-poster-tag' },
            },
          ],
        });
      }
      if (url.pathname === '/Items/emby-item-7/Images/Primary') {
        return new Response('emby-poster', {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return json({}, 404);
    }) as typeof fetch,
  );
  const health = await provider.health();
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
  const poster = await provider.getPoster('emby-item-7', library[0].metadata);
  assert(health.available && health.message === 'Emby 4.9.1', '读取 Emby 版本');
  assert(
    matches.length === 1 &&
      matches[0].playbackUrl ===
        'http://emby.test/web/index.html#!/item?id=emby-item-7&serverId=emby-server-id',
    '匹配 Emby 条目并生成无密钥播放链接',
  );
  assert(
    library.length === 1 && library[0].externalRefs.length === 2,
    '分页读取 Emby 媒体库及外部编号',
  );
  assert(
    poster?.contentType === 'image/png' &&
      poster.body.toString() === 'emby-poster' &&
      !requests.some((url) => url.search.includes('contract-secret')),
    '通过请求头安全读取 Emby 海报',
  );
}

async function testMoviePilot() {
  const methods: string[] = [];
  const provider = new MoviePilotAutomationProvider(
    config('moviepilot'),
    (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      methods.push(`${method} ${url.pathname}`);
      assert(
        new Headers(init?.headers).get('X-API-KEY') === 'contract-secret',
        'MoviePilot 使用长期 X-API-KEY',
      );
      if (url.pathname === '/api/v1/system/env') {
        return json({ data: { version: 'v2.9.0' } });
      }
      if (url.pathname === '/api/v1/subscribe/media/themoviedb%3A550') {
        return json({});
      }
      if (url.pathname === '/api/v1/subscribe/' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert(
          body.type === '电影' && body.tmdbid === 550,
          'MoviePilot 订阅使用官方中文媒体类型和 TMDB ID',
        );
        return json({ success: true, data: { id: 88 } });
      }
      if (url.pathname === '/api/v1/subscribe/88' && method === 'DELETE') {
        return json({ success: true });
      }
      if (url.pathname === '/api/v1/subscribe/88') {
        return json({ id: 88, state: 'R', type: '电影', tmdbid: 550 });
      }
      return json({}, 404);
    }) as typeof fetch,
  );
  const media: MediaMetadataSnapshot = {
    type: 'movie',
    title: 'Fight Club',
    originalTitle: 'Fight Club',
    year: 1999,
    overview: null,
    posterUrl: null,
    externalRefs: references,
    metadata: {},
  };
  const health = await provider.health();
  const request = await provider.requestMedia(media, 'contract-idempotency');
  const cancelled = await provider.cancelRequest(request.requestId);
  assert(
    health.available && health.message === 'MoviePilot v2.9.0',
    '读取 MoviePilot 版本',
  );
  assert(request.requestId === '88' && request.status === 'processing', '创建并读取 MoviePilot 订阅');
  assert(cancelled.status === 'cancelled', '取消 MoviePilot 订阅');
  assert(methods.filter((value) => value === 'POST /api/v1/subscribe/').length === 1, '创建订阅只调用一次');
}

async function main() {
  await testPlex();
  await testEmby();
  await testMoviePilot();
  console.log('媒体连接器契约测试通过：Plex、Emby、MoviePilot');
}

void main();
