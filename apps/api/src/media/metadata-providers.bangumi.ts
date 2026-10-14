import { MediaExternalProvider, MediaType } from '../entities';
import { BangumiMetadataConfig } from './metadata.config';
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
} from './metadata-providers';

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
