import { MediaExternalProvider, MediaType } from '../entities';
import { DoubanMetadataConfig } from './metadata.config';
import {
  MediaExternalReference,
  MediaMetadataProvider,
  MediaMetadataSnapshot,
  MediaSearchQuery,
} from './providers';
import {
  Fetcher,
  JsonRecord,
  asRecord,
  asArray,
  asString,
  asNumber,
  yearFrom,
  absoluteUrl,
  buildUrl,
  fetchJson,
  failedHealth,
  isSnapshot,
  allowedBridgeRefs,
} from './metadata-providers';

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
