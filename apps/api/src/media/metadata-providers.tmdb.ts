import { MediaExternalProvider, MediaType } from '../entities';
import { TmdbMetadataConfig } from './metadata.config';
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
  buildUrl,
  fetchJson,
  failedHealth,
  isSnapshot,
} from './metadata-providers';

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
