import {
  MediaExternalProvider,
  MediaType,
} from '../entities';
import {
  MediaAutomationProvider,
  MediaAutomationRequest,
  MediaExternalReference,
  MediaLibraryMatch,
  MediaLibraryProvider,
  MediaMetadataSnapshot,
  MediaProviderHealth,
} from './providers';
import {
  MediaConnectorConfig,
  MediaConnectorKind,
} from './connectors.config';

type Fetcher = typeof fetch;

interface JsonRecord {
  [key: string]: unknown;
}

export class MediaConnectorError extends Error {
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
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function asString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

function buildUrl(baseUrl: string, path: string, params?: URLSearchParams) {
  const url = new URL(path, `${baseUrl}/`);
  if (params) url.search = params.toString();
  return url;
}

async function fetchJson(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 5000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaConnectorError('连接超时');
    }
    throw new MediaConnectorError('无法连接服务');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MediaConnectorError('凭据无效或权限不足', response.status);
    }
    throw new MediaConnectorError(`服务返回 HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MediaConnectorError('服务返回了无法识别的数据');
  }
}

function healthFailure(error: unknown): MediaProviderHealth {
  return {
    available: false,
    checkedAt: new Date(),
    message: error instanceof Error ? error.message : '连接失败',
  };
}

function externalRefKey(reference: MediaExternalReference) {
  return `${reference.provider}:${reference.externalId.toLocaleLowerCase('en-US')}`;
}

function relevantExternalRefs(references: MediaExternalReference[]) {
  return references.filter(
    (reference) => reference.provider === 'tmdb' || reference.provider === 'imdb',
  );
}

export interface ConfiguredLibraryProvider {
  config: MediaConnectorConfig;
  provider: MediaLibraryProvider;
}

export class PlexLibraryProvider implements MediaLibraryProvider {
  readonly provider: MediaExternalProvider = 'plex';
  private identity: {
    machineIdentifier: string;
    version: string | null;
  } | null = null;

  constructor(
    readonly config: MediaConnectorConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private headers() {
    return {
      Accept: 'application/json',
      'X-Plex-Token': this.config.credential ?? '',
      'X-Plex-Product': 'Family App',
      'X-Plex-Client-Identifier': 'family-app-api',
    };
  }

  private async request(path: string, params?: URLSearchParams) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 Token');
    }
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      { headers: this.headers() },
    );
  }

  private async getIdentity() {
    if (this.identity) return this.identity;
    const body = asRecord(await this.request('/identity'));
    const container = asRecord(body.MediaContainer);
    const machineIdentifier = asString(container.machineIdentifier);
    if (!machineIdentifier) throw new MediaConnectorError('Plex 未返回服务器标识');
    this.identity = {
      machineIdentifier,
      version: asString(container.version),
    };
    return this.identity;
  }

  async health(): Promise<MediaProviderHealth> {
    try {
      const identity = await this.getIdentity();
      await this.request('/library/sections');
      return {
        available: true,
        checkedAt: new Date(),
        message: identity.version ? `Plex ${identity.version}` : 'Plex 已连接',
      };
    } catch (error) {
      return healthFailure(error);
    }
  }

  async findByExternalRefs(
    externalRefs: MediaExternalReference[],
  ): Promise<MediaLibraryMatch[]> {
    const references = relevantExternalRefs(externalRefs);
    if (!references.length) return [];
    const items = new Map<string, JsonRecord>();
    for (const reference of references) {
      const params = new URLSearchParams({
        guid: `${reference.provider}://${reference.externalId}`,
        includeGuids: '1',
      });
      const body = asRecord(await this.request('/library/all', params));
      const container = asRecord(body.MediaContainer);
      const candidates = [
        ...asArray(container.Metadata),
        ...asArray(container.Video),
        ...asArray(container.Directory),
      ];
      for (const candidate of candidates) {
        const item = asRecord(candidate);
        const id = asString(item.ratingKey) ?? asString(item.key);
        if (id) items.set(id.replace(/^\/library\/metadata\//, ''), item);
      }
    }
    const requestedKeys = new Set(references.map(externalRefKey));
    const matches: MediaLibraryMatch[] = [];
    for (const [libraryItemId, item] of items) {
      const itemRefs = asArray(item.Guid)
        .map((value) => asString(asRecord(value).id))
        .filter((value): value is string => Boolean(value))
        .flatMap<MediaExternalReference>((value) => {
          const match = /^(tmdb|imdb):\/\/(.+)$/i.exec(value);
          if (!match) return [];
          return [
            {
              provider: match[1].toLowerCase() as Extract<
                MediaExternalProvider,
                'tmdb' | 'imdb'
              >,
              mediaType: item.type === 'show' ? 'series' : 'movie',
              externalId: match[2],
            },
          ];
        });
      if (
        itemRefs.length &&
        !itemRefs.some((reference) =>
          requestedKeys.has(externalRefKey(reference)),
        )
      ) {
        continue;
      }
      matches.push({
        libraryItemId,
        externalRefs: [
          ...itemRefs,
          {
            provider: 'plex',
            mediaType: item.type === 'show' ? 'series' : 'movie',
            externalId: libraryItemId,
            connectorKey: this.config.key,
          },
        ],
        available: true,
        playbackUrl: await this.getPlaybackTarget(libraryItemId),
        metadata: {
          title: asString(item.title),
          year: item.year ?? null,
        },
      });
    }
    return matches;
  }

  async getPlaybackTarget(libraryItemId: string) {
    if (!this.config.baseUrl) return null;
    const identity = await this.getIdentity();
    const key = encodeURIComponent(`/library/metadata/${libraryItemId}`);
    return `${this.config.baseUrl}/web/index.html#!/server/${encodeURIComponent(
      identity.machineIdentifier,
    )}/details?key=${key}`;
  }
}

export class EmbyLibraryProvider implements MediaLibraryProvider {
  readonly provider: MediaExternalProvider = 'emby';
  private serverInfo: { id: string; version: string | null } | null = null;

  constructor(
    readonly config: MediaConnectorConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(path: string, params?: URLSearchParams) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 API Key');
    }
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      {
        headers: {
          Accept: 'application/json',
          'X-Emby-Token': this.config.credential,
        },
      },
    );
  }

  private async getServerInfo() {
    if (this.serverInfo) return this.serverInfo;
    const body = asRecord(await this.request('/System/Info'));
    const id = asString(body.Id);
    if (!id) throw new MediaConnectorError('Emby 未返回服务器标识');
    this.serverInfo = { id, version: asString(body.Version) };
    return this.serverInfo;
  }

  async health(): Promise<MediaProviderHealth> {
    try {
      const info = await this.getServerInfo();
      return {
        available: true,
        checkedAt: new Date(),
        message: info.version ? `Emby ${info.version}` : 'Emby 已连接',
      };
    } catch (error) {
      return healthFailure(error);
    }
  }

  async findByExternalRefs(
    externalRefs: MediaExternalReference[],
  ): Promise<MediaLibraryMatch[]> {
    const references = relevantExternalRefs(externalRefs);
    if (!references.length) return [];
    const providerValues = references.map(
      (reference) =>
        `${reference.provider === 'tmdb' ? 'Tmdb' : 'Imdb'}.${reference.externalId}`,
    );
    const params = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series',
      Fields: 'ProviderIds',
      AnyProviderIdEquals: providerValues.join(','),
      Limit: '25',
    });
    const body = asRecord(await this.request('/Items', params));
    const matches: MediaLibraryMatch[] = [];
    for (const value of asArray(body.Items)) {
      const item = asRecord(value);
      const libraryItemId = asString(item.Id);
      if (!libraryItemId) continue;
      const providerIds = asRecord(item.ProviderIds);
      const itemRefs: MediaExternalReference[] = [];
      const tmdbId = asString(providerIds.Tmdb);
      const imdbId = asString(providerIds.Imdb);
      const mediaType: MediaType = item.Type === 'Series' ? 'series' : 'movie';
      if (tmdbId) {
        itemRefs.push({ provider: 'tmdb', mediaType, externalId: tmdbId });
      }
      if (imdbId) {
        itemRefs.push({ provider: 'imdb', mediaType, externalId: imdbId });
      }
      matches.push({
        libraryItemId,
        externalRefs: [
          ...itemRefs,
          {
            provider: 'emby',
            mediaType,
            externalId: libraryItemId,
            connectorKey: this.config.key,
          },
        ],
        available: true,
        playbackUrl: await this.getPlaybackTarget(libraryItemId),
        metadata: {
          title: asString(item.Name),
          productionYear: item.ProductionYear ?? null,
        },
      });
    }
    return matches;
  }

  async getPlaybackTarget(libraryItemId: string) {
    if (!this.config.baseUrl) return null;
    const info = await this.getServerInfo();
    return `${this.config.baseUrl}/web/index.html#!/item?id=${encodeURIComponent(
      libraryItemId,
    )}&serverId=${encodeURIComponent(info.id)}`;
  }
}

interface MoviePilotSubscription extends JsonRecord {
  id?: number;
  state?: string;
  tmdbid?: number;
  imdbid?: string;
  type?: string;
}

export class MoviePilotAutomationProvider implements MediaAutomationProvider {
  readonly provider: MediaExternalProvider = 'moviepilot';

  constructor(
    readonly config: MediaConnectorConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
    params?: URLSearchParams,
  ) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 API Key');
    }
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-API-KEY', this.config.credential);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      { ...init, headers },
    );
  }

  async health(): Promise<MediaProviderHealth> {
    try {
      const body = asRecord(await this.request('/api/v1/system/env'));
      const version =
        asString(body.version) ??
        asString(asRecord(body.data).version) ??
        asString(asRecord(body.data).VERSION_FLAG);
      return {
        available: true,
        checkedAt: new Date(),
        message: version ? `MoviePilot ${version}` : 'MoviePilot 已连接',
      };
    } catch (error) {
      return healthFailure(error);
    }
  }

  async requestMedia(
    media: MediaMetadataSnapshot,
    _idempotencyKey: string,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest> {
    const tmdb = media.externalRefs.find(
      (reference) => reference.provider === 'tmdb',
    );
    if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
      throw new MediaConnectorError('MoviePilot 订阅需要有效的 TMDB ID');
    }
    const season = media.type === 'series' ? options.season : undefined;
    if (media.type === 'series' && (!season || season < 1)) {
      throw new MediaConnectorError('剧集订阅需要选择季数');
    }
    const mediaKey = `themoviedb:${tmdb.externalId}`;
    const existing = asRecord(
      await this.request(
        `/api/v1/subscribe/media/${encodeURIComponent(mediaKey)}`,
        {},
        season ? new URLSearchParams({ season: String(season) }) : undefined,
      ),
    ) as MoviePilotSubscription;
    if (existing.id) return this.present(existing, media.externalRefs);

    const response = asRecord(
      await this.request('/api/v1/subscribe/', {
        method: 'POST',
        body: JSON.stringify({
          name: media.title,
          year: media.year ? String(media.year) : undefined,
          type: media.type === 'movie' ? '电影' : '电视剧',
          tmdbid: Number(tmdb.externalId),
          season,
        }),
      }),
    );
    if (response.success !== true) {
      throw new MediaConnectorError(
        asString(response.message) ?? 'MoviePilot 创建订阅失败',
      );
    }
    const id = asString(asRecord(response.data).id);
    if (!id) throw new MediaConnectorError('MoviePilot 未返回订阅编号');
    const created = asRecord(await this.request(`/api/v1/subscribe/${id}`));
    return this.present({ ...created, id: Number(id) }, media.externalRefs);
  }

  async getRequest(requestId: string): Promise<MediaAutomationRequest | null> {
    const body = asRecord(
      await this.request(
        `/api/v1/subscribe/${encodeURIComponent(requestId)}`,
      ),
    );
    if (!body.id) return null;
    return this.present(body as MoviePilotSubscription, []);
  }

  async cancelRequest(requestId: string): Promise<MediaAutomationRequest> {
    const existing = await this.getRequest(requestId);
    if (!existing) throw new MediaConnectorError('MoviePilot 订阅不存在');
    const body = asRecord(
      await this.request(`/api/v1/subscribe/${encodeURIComponent(requestId)}`, {
        method: 'DELETE',
      }),
    );
    if (body.success !== true) {
      throw new MediaConnectorError(
        asString(body.message) ?? '取消 MoviePilot 订阅失败',
      );
    }
    return { ...existing, status: 'cancelled', updatedAt: new Date() };
  }

  private present(
    subscription: MoviePilotSubscription,
    fallbackRefs: MediaExternalReference[],
  ): MediaAutomationRequest {
    const mediaType: MediaType =
      subscription.type === '电视剧' ? 'series' : 'movie';
    const externalRefs = [...fallbackRefs];
    if (subscription.tmdbid) {
      externalRefs.push({
        provider: 'tmdb',
        mediaType,
        externalId: String(subscription.tmdbid),
      });
    }
    if (subscription.imdbid) {
      externalRefs.push({
        provider: 'imdb',
        mediaType,
        externalId: subscription.imdbid,
      });
    }
    const refs = new Map(
      externalRefs.map((reference) => [externalRefKey(reference), reference]),
    );
    return {
      requestId: String(subscription.id),
      status: subscription.state === 'N' ? 'pending' : 'processing',
      externalRefs: [...refs.values()],
      updatedAt: new Date(),
    };
  }
}

export function connectorRole(kind: MediaConnectorKind) {
  return kind === 'moviepilot' ? 'automation' as const : 'library' as const;
}
