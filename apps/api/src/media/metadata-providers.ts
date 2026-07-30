import { MediaExternalProvider, MediaType } from '../entities';
import {
  BangumiMetadataConfig,
  DoubanMetadataConfig,
  TmdbMetadataConfig,
} from './metadata.config';
import {
  MediaExternalReference,
  MediaMetadataProvider,
  MediaMetadataSnapshot,
  MediaProviderHealth,
  MediaSearchQuery,
} from './providers';

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

export class MediaMetadataError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

function asNumber(value: unknown) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function yearFrom(value: unknown) {
  const match = asString(value)?.match(/^(\d{4})/);
  const year = match ? Number(match[1]) : null;
  return year && year >= 1878 && year <= 2199 ? year : null;
}

function absoluteUrl(value: unknown) {
  const candidate = asString(value)?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchJson(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 6000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaMetadataError('连接超时');
    }
    throw new MediaMetadataError('无法连接服务');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MediaMetadataError('凭据无效或权限不足', response.status);
    }
    if (response.status === 429) {
      throw new MediaMetadataError('请求过于频繁，请稍后再试', response.status);
    }
    throw new MediaMetadataError(`服务返回 HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MediaMetadataError('服务返回了无法识别的数据');
  }
}

function failedHealth(error: unknown): MediaProviderHealth {
  return {
    available: false,
    checkedAt: new Date(),
    message: error instanceof Error ? error.message : '连接失败',
  };
}

function isSnapshot(
  value: MediaMetadataSnapshot | null,
): value is MediaMetadataSnapshot {
  return value !== null;
}

function allowedBridgeRefs(
  value: unknown,
  type: MediaType,
): MediaExternalReference[] {
  const allowed = new Set<MediaExternalProvider>([
    'tmdb',
    'imdb',
    'bangumi',
  ]);
  return asArray(value).flatMap((candidate) => {
    const record = asRecord(candidate);
    const provider = asString(record.provider) as MediaExternalProvider | null;
    const externalId = asString(record.externalId ?? record.id)?.trim();
    return provider && allowed.has(provider) && externalId
      ? [{ provider, mediaType: type, externalId }]
      : [];
  });
}

export class TmdbMetadataProvider implements MediaMetadataProvider {
  readonly provider: MediaExternalProvider = 'tmdb';

  constructor(
    private readonly config: TmdbMetadataConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async search(query: MediaSearchQuery) {
    const path = query.type
      ? `search/${query.type === 'movie' ? 'movie' : 'tv'}`
      : 'search/multi';
    const body = asRecord(
      await this.request(path, {
        query: query.query,
        language: 'zh-CN',
        include_adult: false,
        page: 1,
        ...(query.year && query.type === 'movie' ? { year: query.year } : {}),
        ...(query.year && query.type === 'series'
          ? { first_air_date_year: query.year }
          : {}),
      }),
    );
    return asArray(body.results)
      .flatMap((value) => {
        const record = asRecord(value);
        const inferred =
          query.type ?? this.tmdbType(asString(record.media_type));
        return inferred ? [this.snapshot(record, inferred)] : [];
      })
      .filter(isSnapshot)
      .filter((value) => !query.year || value.year === query.year)
      .slice(0, 12);
  }

  async get(reference: MediaExternalReference) {
    if (reference.provider !== 'tmdb') return null;
    const body = asRecord(
      await this.request(
        `${reference.mediaType === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(reference.externalId)}`,
        { language: 'zh-CN', append_to_response: 'external_ids' },
      ),
    );
    return this.snapshot(body, reference.mediaType);
  }

  async health() {
    try {
      await this.request('configuration');
      return { available: true, checkedAt: new Date(), message: 'TMDB 已连接' };
    } catch (error) {
      return failedHealth(error);
    }
  }

  private tmdbType(value: string | null): MediaType | null {
    if (value === 'movie') return 'movie';
    if (value === 'tv') return 'series';
    return null;
  }

  private snapshot(
    record: JsonRecord,
    type: MediaType,
  ): MediaMetadataSnapshot | null {
    const id = asString(record.id)?.trim();
    const title = asString(record.title ?? record.name)?.trim();
    if (!id || !title) return null;
    const originalTitle = asString(
      record.original_title ?? record.original_name,
    )?.trim();
    const posterPath = asString(record.poster_path)?.trim();
    const externalIds = asRecord(record.external_ids);
    const imdbId = asString(record.imdb_id ?? externalIds.imdb_id)?.trim();
    return {
      type,
      title,
      originalTitle:
        originalTitle && originalTitle !== title ? originalTitle : null,
      year: yearFrom(record.release_date ?? record.first_air_date),
      overview: asString(record.overview)?.trim() || null,
      posterUrl: posterPath
        ? `${this.config.imageBaseUrl}/${posterPath.replace(/^\/+/, '')}`
        : null,
      externalRefs: [
        { provider: 'tmdb' as const, mediaType: type, externalId: id },
        ...(imdbId
          ? [{ provider: 'imdb' as const, mediaType: type, externalId: imdbId }]
          : []),
      ],
      metadata: {
        source: 'tmdb',
        originalLanguage: asString(record.original_language),
        popularity: asNumber(record.popularity),
        voteAverage: asNumber(record.vote_average),
        voteCount: asNumber(record.vote_count),
      },
    } satisfies MediaMetadataSnapshot;
  }

  private request(
    path: string,
    params?: Record<string, string | number | boolean>,
  ) {
    const headers = new Headers({ Accept: 'application/json' });
    if (this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, {
        ...params,
        ...(!this.config.token && this.config.apiKey
          ? { api_key: this.config.apiKey }
          : {}),
      }),
      { headers },
    );
  }
}

export class BangumiMetadataProvider implements MediaMetadataProvider {
  readonly provider: MediaExternalProvider = 'bangumi';

  constructor(
    private readonly config: BangumiMetadataConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async search(query: MediaSearchQuery) {
    const body = asRecord(
      await this.request(
        'v0/search/subjects',
        {
          method: 'POST',
          body: JSON.stringify({ keyword: query.query, filter: { type: [2] } }),
        },
        { limit: 12, offset: 0 },
      ),
    );
    return asArray(body.data)
      .map((value) => this.snapshot(asRecord(value)))
      .filter(isSnapshot)
      .filter(
        (value) =>
          (!query.type || value.type === query.type) &&
          (!query.year || value.year === query.year),
      )
      .slice(0, 12);
  }

  async get(reference: MediaExternalReference) {
    if (reference.provider !== 'bangumi') return null;
    const body = asRecord(
      await this.request(
        `v0/subjects/${encodeURIComponent(reference.externalId)}`,
      ),
    );
    return this.snapshot(body);
  }

  async health() {
    try {
      await this.request('v0/subjects/1');
      return {
        available: true,
        checkedAt: new Date(),
        message: 'Bangumi 已连接',
      };
    } catch (error) {
      return failedHealth(error);
    }
  }

  private snapshot(record: JsonRecord): MediaMetadataSnapshot | null {
    const id = asString(record.id)?.trim();
    const original = asString(record.name)?.trim();
    const localized = asString(record.name_cn)?.trim();
    const title = localized || original;
    if (!id || !title) return null;
    const platform = asString(record.platform)?.trim() || '';
    const type: MediaType = /剧场|电影|movie/i.test(platform)
      ? 'movie'
      : 'series';
    const images = asRecord(record.images);
    const rating = asRecord(record.rating);
    return {
      type,
      title,
      originalTitle: original && original !== title ? original : null,
      year: yearFrom(record.date),
      overview: asString(record.summary)?.trim() || null,
      posterUrl:
        absoluteUrl(images.large ?? images.common ?? images.medium ?? images.small) ??
        null,
      externalRefs: [
        { provider: 'bangumi', mediaType: type, externalId: id },
      ],
      metadata: {
        source: 'bangumi',
        platform: platform || null,
        rating: asNumber(rating.score),
        ratingCount: asNumber(rating.total),
      },
    } satisfies MediaMetadataSnapshot;
  }

  private request(
    path: string,
    init: RequestInit = {},
    params?: Record<string, string | number | boolean>,
  ) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    headers.set('User-Agent', this.config.userAgent);
    if (this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      { ...init, headers },
    );
  }
}

export class DoubanMetadataProvider implements MediaMetadataProvider {
  readonly provider: MediaExternalProvider = 'douban';

  constructor(
    private readonly config: DoubanMetadataConfig & { baseUrl: string },
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async search(query: MediaSearchQuery) {
    const body = await this.request('search', undefined, {
      query: query.query,
      type: query.type,
      year: query.year,
      limit: 12,
    });
    const record = asRecord(body);
    const candidates = Array.isArray(body)
      ? body
      : asArray(record.results).length
        ? asArray(record.results)
        : asArray(record.subjects);
    return candidates
      .map((value) => this.snapshot(asRecord(value), query.type))
      .filter(isSnapshot)
      .filter(
        (value) =>
          (!query.type || value.type === query.type) &&
          (!query.year || value.year === query.year),
      )
      .slice(0, 12);
  }

  async get(reference: MediaExternalReference) {
    if (reference.provider !== 'douban') return null;
    const body = asRecord(
      await this.request(
        `subjects/${encodeURIComponent(reference.externalId)}`,
        undefined,
        { type: reference.mediaType },
      ),
    );
    return this.snapshot(body, reference.mediaType);
  }

  async health() {
    try {
      await this.request('health');
      return { available: true, checkedAt: new Date(), message: '豆瓣桥接已连接' };
    } catch (error) {
      return failedHealth(error);
    }
  }

  private snapshot(
    record: JsonRecord,
    fallbackType?: MediaType,
  ): MediaMetadataSnapshot | null {
    const id = asString(record.id ?? record.doubanId ?? record.douban_id)?.trim();
    const title = asString(record.title ?? record.name)?.trim();
    if (!id || !title) return null;
    const rawType = asString(record.type ?? record.subtype)?.toLowerCase();
    const type: MediaType = rawType
      ? /tv|series|show|电视剧|动画/.test(rawType)
        ? 'series'
        : 'movie'
      : fallbackType ?? 'movie';
    const images = asRecord(record.images);
    const rating = asRecord(record.rating);
    const refs = allowedBridgeRefs(record.externalRefs, type);
    const imdbId = asString(record.imdbId ?? record.imdb_id)?.trim();
    const uniqueRefs = new Map<string, MediaExternalReference>();
    for (const ref of [
      { provider: 'douban' as const, mediaType: type, externalId: id },
      ...refs,
      ...(imdbId
        ? [{ provider: 'imdb' as const, mediaType: type, externalId: imdbId }]
        : []),
    ]) {
      uniqueRefs.set(`${ref.provider}:${ref.externalId.toLowerCase()}`, ref);
    }
    const originalTitle = asString(
      record.originalTitle ?? record.original_title ?? record.originalName,
    )?.trim();
    return {
      type,
      title,
      originalTitle:
        originalTitle && originalTitle !== title ? originalTitle : null,
      year: yearFrom(record.year ?? record.releaseDate ?? record.release_date),
      overview: asString(record.overview ?? record.summary)?.trim() || null,
      posterUrl:
        absoluteUrl(
          record.posterUrl ?? record.poster_url ?? record.cover ?? images.large,
        ) ?? null,
      externalRefs: [...uniqueRefs.values()],
      metadata: {
        source: 'douban',
        rating: asNumber(record.ratingValue ?? rating.average ?? rating.value),
        ratingCount: asNumber(record.ratingCount ?? record.ratings_count),
      },
    } satisfies MediaMetadataSnapshot;
  }

  private request(
    path: string,
    init: RequestInit = {},
    params?: Record<string, string | number | boolean | undefined>,
  ) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      { ...init, headers },
    );
  }
}
