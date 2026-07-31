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
  const users = await provider.listUsers();
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
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
      if (url.pathname === '/Users') {
        return json([
          { Id: 'emby-user-1', Name: '爸爸 Emby', Policy: { IsDisabled: false } },
          { Id: 'emby-user-2', Name: '妈妈 Emby', Policy: { IsDisabled: true } },
        ]);
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
  const users = await provider.listUsers();
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
  const poster = await provider.getPoster('emby-item-7', library[0].metadata);
  assert(health.available && health.message === 'Emby 4.9.1', '读取 Emby 版本');
  assert(
    users.serverId === 'emby-server-id' &&
      users.users.length === 2 &&
      users.users[1].isDisabled,
    '读取 Emby 稳定服务器标识和用户状态',
  );
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
        return json({ id: 88, state: 'R', type: '电影', tmdbid: 550 });
      }
      if (url.pathname === '/api/v1/subscribe/media/themoviedb%3A1399') {
        assert(url.searchParams.get('season') === '2', '按季找回剧集订阅');
        return json({ id: 99, state: 'N', type: '电视剧', tmdbid: 1399 });
      }
      if (
        url.pathname === '/api/v1/subscribe/media/themoviedb%3A568160' ||
        url.pathname === '/api/v1/subscribe/media/themoviedb%3A1160901' ||
        url.pathname === '/api/v1/subscribe/media/themoviedb%3A888' ||
        url.pathname === '/api/v1/subscribe/media/themoviedb%3A777'
      ) {
        return json({});
      }
      if (url.pathname === '/api/v1/download/' && method === 'GET') {
        return json([
          {
            downloader: 'qBittorrent',
            hash: 'weathering-hash',
            progress: 58.7,
            media: { tmdbid: 568160, season: '' },
          },
        ]);
      }
      if (
        url.pathname === '/api/v1/download/weathering-hash' &&
        method === 'DELETE'
      ) {
        assert(
          url.searchParams.get('name') === 'qBittorrent',
          '取消下载时指定正确的 MoviePilot 下载器',
        );
        return json({ success: true });
      }
      if (url.pathname === '/api/v1/history/transfer') {
        return json({
          success: true,
          data: {
            list: [
              {
                id: 204,
                tmdbid: 1160901,
                seasons: '',
                download_hash: 'dragon-current',
                status: false,
                errmsg: '/media/龙与魔女.mkv 已存在',
                src: '/downloads/dragon-03.mkv',
              },
              {
                id: 203,
                tmdbid: 1160901,
                seasons: '',
                download_hash: 'dragon-current',
                status: true,
                src: '/downloads/dragon-02.mkv',
              },
              {
                id: 202,
                tmdbid: 1160901,
                seasons: '',
                download_hash: 'dragon-current',
                status: true,
                src: '/downloads/dragon-01.mkv',
              },
              {
                id: 201,
                tmdbid: 1160901,
                seasons: '',
                download_hash: 'dragon-current',
                status: false,
                errmsg: '/media/龙与魔女.mkv 已存在',
                src: '/downloads/dragon-02.mkv',
              },
              {
                id: 101,
                tmdbid: 1160901,
                seasons: '',
                download_hash: 'dragon-old',
                status: true,
              },
              {
                id: 100,
                tmdbid: 888,
                seasons: '',
                download_hash: 'completed-movie',
                status: true,
              },
            ],
            total: 1,
          },
        });
      }
      if (url.pathname === '/api/v1/history/download') {
        return json([{ tmdbid: 777, seasons: '' }]);
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
  assert(
    request.requestId === '88' && request.status === 'pending',
    '创建 MoviePilot 订阅后直接返回待处理状态',
  );
  assert(
    !methods.includes('GET /api/v1/subscribe/88') &&
      !methods.includes('GET /api/v1/subscribe/media/themoviedb%3A550'),
    '创建订阅不执行多余的前置或确认查询',
  );
  const recovered = await provider.findRequest(media);
  assert(
    recovered?.requestId === '88' && recovered.status === 'processing',
    '可以按 TMDB ID 找回 MoviePilot 订阅编号和状态',
  );
  const recoveredSeason = await provider.findRequest(
    {
      ...media,
      type: 'series',
      title: 'Game of Thrones',
      externalRefs: [
        {
          provider: 'tmdb',
          mediaType: 'series',
          externalId: '1399',
        },
      ],
    },
    { season: 2 },
  );
  assert(
    recoveredSeason?.requestId === '99' && recoveredSeason.status === 'pending',
    '剧集可以按 TMDB ID 和季数找回 MoviePilot 订阅',
  );
  const mediaWithTmdbId = (tmdbId: string): MediaMetadataSnapshot => ({
    ...media,
    externalRefs: [
      {
        provider: 'tmdb',
        mediaType: 'movie',
        externalId: tmdbId,
      },
    ],
  });
  const activeDownload = await provider.findRequest(mediaWithTmdbId('568160'));
  assert(
    activeDownload?.status === 'processing' &&
      activeDownload.requestId.startsWith('media-download:') &&
      activeDownload.message?.includes('59%'),
    '订阅转入下载器后可以按 TMDB ID 恢复下载进度',
  );
  const refreshedDownload = await provider.getRequest(activeDownload.requestId);
  assert(
    refreshedDownload?.status === 'processing',
    '恢复下载编号后可以继续刷新 MoviePilot 下载状态',
  );
  const cancelledDownload = await provider.cancelRequest(activeDownload.requestId);
  assert(
    cancelledDownload.status === 'cancelled' &&
      methods.includes('DELETE /api/v1/download/weathering-hash'),
    '取消已开始的 MoviePilot 下载任务',
  );
  const incompleteTransfer = await provider.findRequest(
    mediaWithTmdbId('1160901'),
  );
  assert(
    incompleteTransfer?.status === 'failed' &&
      incompleteTransfer.message ===
        'MoviePilot 整理不完整 · 2 成功 / 1 失败 · 目标文件已存在',
    '同一下载批次按源文件只取最新结果，且不误报部分失败为完成',
  );
  const completedTransfer = await provider.findRequest(mediaWithTmdbId('888'));
  assert(
    completedTransfer?.status === 'completed' &&
      completedTransfer.message === 'MoviePilot 已完成整理',
    '订阅离开下载器后可以从整理历史确认完成',
  );
  const pendingTransfer = await provider.findRequest(mediaWithTmdbId('777'));
  assert(
    pendingTransfer?.status === 'processing' &&
      pendingTransfer.message === 'MoviePilot 已接收下载，等待整理完成',
    '只有下载历史时保持等待整理状态',
  );
  const cancelled = await provider.cancelRequest(request.requestId);
  assert(
    health.available && health.message === 'MoviePilot v2.9.0',
    '读取 MoviePilot 版本',
  );
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
