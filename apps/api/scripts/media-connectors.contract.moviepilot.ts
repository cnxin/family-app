import { MoviePilotAutomationProvider } from '../src/media/connectors.moviepilot';
import { MediaMetadataSnapshot } from '../src/media/providers';
import { assert, json, config, references } from './media-connectors.contract.helpers';

export async function testMoviePilot() {
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
