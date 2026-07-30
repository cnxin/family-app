import assert from 'node:assert/strict';
import { MediaMetadataService } from '../src/media/media-metadata.service';
import { MediaSourceSettingsService } from '../src/media/media-source-settings.service';
import { mediaMetadataConfig } from '../src/media/metadata.config';

const environmentKeys = [
  'TMDB_API_BASE_URL',
  'TMDB_IMAGE_BASE_URL',
  'TMDB_API_TOKEN',
  'TMDB_API_TOKEN_FILE',
  'TMDB_API_KEY',
  'TMDB_API_KEY_FILE',
  'DOUBAN_API_BASE_URL',
  'DOUBAN_API_TOKEN',
  'DOUBAN_API_TOKEN_FILE',
  'BANGUMI_API_BASE_URL',
  'BANGUMI_ACCESS_TOKEN',
  'BANGUMI_ACCESS_TOKEN_FILE',
  'BANGUMI_USER_AGENT',
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;
const requestCounts = new Map<string, number>();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function count(host: string) {
  requestCounts.set(host, (requestCounts.get(host) ?? 0) + 1);
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
  count(url.host);
  const headers = new Headers(init?.headers);

  if (url.host === 'tmdb.test') {
    assert.equal(headers.get('Authorization'), 'Bearer tmdb-contract-token');
    assert.equal(url.pathname, '/3/search/movie');
    assert.equal(url.searchParams.get('language'), 'zh-CN');
    assert.equal(url.searchParams.get('include_adult'), 'false');
    return json({
      results: [
        {
          id: 123,
          media_type: 'movie',
          title: '流浪地球',
          original_title: 'The Wandering Earth',
          release_date: '2019-02-05',
          overview: 'TMDB 简介',
          poster_path: '/tmdb.jpg',
          vote_average: 7.9,
        },
      ],
    });
  }

  if (url.host === 'douban.test') {
    assert.equal(headers.get('Authorization'), 'Bearer douban-contract-token');
    assert.equal(url.pathname, '/bridge/search');
    assert.equal(url.searchParams.get('type'), 'movie');
    return json({
      results: [
        {
          id: '26266893',
          type: 'movie',
          title: '流浪地球',
          originalTitle: 'The Wandering Earth',
          year: '2019',
          summary: '豆瓣中文剧情简介内容更加完整',
          posterUrl: 'https://img.test/douban.jpg',
          rating: { average: 7.9 },
        },
      ],
    });
  }

  if (url.host === 'bangumi.test') {
    assert.equal(headers.get('User-Agent'), 'family-app-contract/1.0');
    assert.equal(url.pathname, '/v0/search/subjects');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.filter, { type: [2] });
    if (body.keyword === '降级测试') return json({}, 503);
    return json({
      data: [
        {
          id: 999,
          type: 2,
          name: 'The Wandering Earth',
          name_cn: '流浪地球',
          date: '2019-02-05',
          platform: '剧场版',
          summary: 'Bangumi 简介',
          images: { large: 'https://img.test/bangumi.jpg' },
          rating: { score: 8.1, total: 88 },
        },
      ],
    });
  }

  throw new Error(`未处理的契约请求：${url.host}${url.pathname}`);
};

async function main() {
  try {
    process.env.TMDB_API_BASE_URL = 'https://tmdb.test/3';
    process.env.TMDB_IMAGE_BASE_URL = 'https://image.test/w500';
    process.env.TMDB_API_TOKEN = 'tmdb-contract-token';
    process.env.TMDB_API_TOKEN_FILE = '';
    process.env.TMDB_API_KEY = '';
    process.env.TMDB_API_KEY_FILE = '';
    process.env.DOUBAN_API_BASE_URL = 'https://douban.test/bridge';
    process.env.DOUBAN_API_TOKEN = 'douban-contract-token';
    process.env.DOUBAN_API_TOKEN_FILE = '';
    process.env.BANGUMI_API_BASE_URL = 'https://bangumi.test';
    process.env.BANGUMI_ACCESS_TOKEN = '';
    process.env.BANGUMI_ACCESS_TOKEN_FILE = '';
    process.env.BANGUMI_USER_AGENT = 'family-app-contract/1.0';
    globalThis.fetch = fakeFetch;

    const settings = {
      resolve: async () => ({
        config: mediaMetadataConfig(),
        enabled: { tmdb: true, douban: true, bangumi: true },
        version: 'contract-config',
      }),
    } as unknown as MediaSourceSettingsService;
    const service = new MediaMetadataService(settings);
    const first = await service.search(
      { query: '流浪地球', type: 'movie' },
      'contract-household',
    );
    assert.deepEqual(
      first.sources.map((source) => source.provider),
      ['douban', 'tmdb', 'bangumi'],
    );
    assert(first.sources.every((source) => source.state === 'online'));
    assert.equal(first.results.length, 1);
    assert.deepEqual(first.results[0].sources, [
      'douban',
      'tmdb',
      'bangumi',
    ]);
    assert.deepEqual(
      first.results[0].externalRefs.map((ref) => ref.provider).sort(),
      ['bangumi', 'douban', 'tmdb'],
    );
    assert.equal(
      first.results[0].overview,
      '豆瓣中文剧情简介内容更加完整',
    );
    assert.equal(first.results[0].posterUrl, 'https://img.test/douban.jpg');

    await service.search(
      { query: '流浪地球', type: 'movie' },
      'contract-household',
    );
    assert.deepEqual(Object.fromEntries(requestCounts), {
      'douban.test': 1,
      'tmdb.test': 1,
      'bangumi.test': 1,
    });

    const degraded = await service.search(
      {
        query: '降级测试',
        type: 'movie',
      },
      'contract-household',
    );
    assert.equal(
      degraded.sources.find((source) => source.provider === 'bangumi')?.state,
      'offline',
    );
    assert(
      degraded.sources
        .filter((source) => source.provider !== 'bangumi')
        .every((source) => source.state === 'online'),
    );

    process.env.TMDB_API_TOKEN = '';
    process.env.DOUBAN_API_BASE_URL = '';
    const partiallyConfigured = new MediaMetadataService(settings);
    const fallback = await partiallyConfigured.search(
      {
        query: '流浪地球',
        type: 'movie',
      },
      'contract-household',
    );
    assert.equal(fallback.sources[0].state, 'not_configured');
    assert.equal(fallback.sources[1].state, 'not_configured');
    assert.equal(fallback.sources[2].state, 'online');
    assert(!JSON.stringify(fallback).includes('contract-token'));
    assert(!JSON.stringify(fallback).includes('bangumi.test'));

    console.log(
      '媒体元数据契约测试通过：TMDB、豆瓣桥接、Bangumi、缓存与单源降级',
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
