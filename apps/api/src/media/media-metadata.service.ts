import { Injectable } from '@nestjs/common';
import { MediaExternalProvider, MediaType } from '../entities';
import { mediaMetadataConfig } from './metadata.config';
import {
  BangumiMetadataProvider,
  DoubanMetadataProvider,
  TmdbMetadataProvider,
} from './metadata-providers';
import {
  MediaExternalReference,
  MediaMetadataProvider,
  MediaMetadataSnapshot,
  MediaSearchQuery,
} from './providers';

type MetadataSource = Extract<
  MediaExternalProvider,
  'tmdb' | 'douban' | 'bangumi'
>;

export interface MediaSearchResult extends MediaMetadataSnapshot {
  key: string;
  sources: MetadataSource[];
}

export interface MediaSourceSearchStatus {
  provider: MetadataSource;
  name: string;
  state: 'not_configured' | 'online' | 'offline';
  resultCount: number;
  message: string;
}

export interface MediaSearchResponse {
  query: string;
  results: MediaSearchResult[];
  sources: MediaSourceSearchStatus[];
}

interface SourceEntry {
  provider: MetadataSource;
  name: string;
  instance: MediaMetadataProvider | null;
  missingMessage: string;
}

interface CacheEntry {
  expiresAt: number;
  response: MediaSearchResponse;
}

const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;

function normalize(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN');
}

function refKey(reference: MediaExternalReference) {
  const typeScope = reference.provider === 'tmdb' ? reference.mediaType : 'global';
  return `${reference.provider}:${typeScope}:${reference.externalId.toLocaleLowerCase('en-US')}`;
}

function titleKeys(result: MediaSearchResult) {
  if (!result.year) return [];
  return [result.title, result.originalTitle]
    .filter((value): value is string => Boolean(value))
    .map((value) => `${result.type}:${result.year}:${normalize(value)}`);
}

function candidateKey(result: MediaSearchResult) {
  return (
    result.externalRefs.map(refKey).sort()[0] ??
    `${result.sources[0]}:${result.type}:${normalize(result.title)}:${result.year ?? 'unknown'}`
  );
}

function mergeResults(results: MediaSearchResult[]) {
  const merged: MediaSearchResult[] = [];
  const refIndexes = new Map<string, number>();
  const titleIndexes = new Map<string, number>();

  for (const candidate of results) {
    const matchingIndexes = new Set<number>();
    for (const reference of candidate.externalRefs) {
      const index = refIndexes.get(refKey(reference));
      if (index != null) matchingIndexes.add(index);
    }
    for (const key of titleKeys(candidate)) {
      const index = titleIndexes.get(key);
      if (index != null) matchingIndexes.add(index);
    }

    const index = matchingIndexes.size === 1 ? [...matchingIndexes][0] : null;
    if (index == null) {
      const next = { ...candidate, key: candidateKey(candidate) };
      const nextIndex = merged.push(next) - 1;
      for (const reference of next.externalRefs) {
        refIndexes.set(refKey(reference), nextIndex);
      }
      for (const key of titleKeys(next)) titleIndexes.set(key, nextIndex);
      continue;
    }

    const current = merged[index];
    const references = new Map(
      [...current.externalRefs, ...candidate.externalRefs].map((reference) => [
        refKey(reference),
        reference,
      ]),
    );
    const sources = [...new Set([...current.sources, ...candidate.sources])];
    merged[index] = {
      ...current,
      originalTitle: current.originalTitle ?? candidate.originalTitle,
      year: current.year ?? candidate.year,
      overview:
        (current.overview?.length ?? 0) >= (candidate.overview?.length ?? 0)
          ? current.overview
          : candidate.overview,
      posterUrl: current.posterUrl ?? candidate.posterUrl,
      externalRefs: [...references.values()],
      metadata: {
        providers: {
          ...((current.metadata.providers as
            | Record<string, unknown>
            | undefined) ?? { [current.sources[0]]: current.metadata }),
          [candidate.sources[0]]: candidate.metadata,
        },
      },
      sources,
      key: [...references.values()].map(refKey).sort()[0] ?? current.key,
    };
    for (const reference of merged[index].externalRefs) {
      refIndexes.set(refKey(reference), index);
    }
    for (const key of titleKeys(merged[index])) titleIndexes.set(key, index);
  }
  return merged.slice(0, 30);
}

@Injectable()
export class MediaMetadataService {
  private readonly sources: SourceEntry[];
  private readonly cache = new Map<string, CacheEntry>();

  constructor() {
    const config = mediaMetadataConfig();
    this.sources = [
      {
        provider: 'douban',
        name: '豆瓣',
        instance: config.douban.baseUrl
          ? new DoubanMetadataProvider({
              ...config.douban,
              baseUrl: config.douban.baseUrl,
            })
          : null,
        missingMessage: '等待配置豆瓣兼容桥接服务',
      },
      {
        provider: 'tmdb',
        name: 'TMDB',
        instance:
          config.tmdb.token || config.tmdb.apiKey
            ? new TmdbMetadataProvider(config.tmdb)
            : null,
        missingMessage: '等待配置 API Token 或 API Key',
      },
      {
        provider: 'bangumi',
        name: 'Bangumi',
        instance: new BangumiMetadataProvider(config.bangumi),
        missingMessage: '',
      },
    ];
  }

  async search(query: MediaSearchQuery): Promise<MediaSearchResponse> {
    const normalizedQuery = normalize(query.query);
    const cacheKey = `${normalizedQuery}:${query.type ?? 'all'}:${query.year ?? 'all'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.response;

    const settled = await Promise.all(
      this.sources.map(async (source) => {
        if (!source.instance) {
          return {
            results: [] as MediaSearchResult[],
            status: {
              provider: source.provider,
              name: source.name,
              state: 'not_configured' as const,
              resultCount: 0,
              message: source.missingMessage,
            },
          };
        }
        try {
          const results = (await source.instance.search(query)).map(
            (result) => ({
              ...result,
              key: '',
              sources: [source.provider],
            }),
          );
          return {
            results,
            status: {
              provider: source.provider,
              name: source.name,
              state: 'online' as const,
              resultCount: results.length,
              message: results.length
                ? `找到 ${results.length} 条`
                : '没有匹配条目',
            },
          };
        } catch (error) {
          return {
            results: [] as MediaSearchResult[],
            status: {
              provider: source.provider,
              name: source.name,
              state: 'offline' as const,
              resultCount: 0,
              message: error instanceof Error ? error.message : '搜索失败',
            },
          };
        }
      }),
    );
    const response = {
      query: query.query,
      results: mergeResults(settled.flatMap((entry) => entry.results)),
      sources: settled.map((entry) => entry.status),
    };
    this.remember(cacheKey, response);
    return response;
  }

  private remember(key: string, response: MediaSearchResponse) {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response });
  }
}
