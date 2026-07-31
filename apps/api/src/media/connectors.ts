import {
  MediaExternalProvider,
  MediaType,
} from '../entities';
import {
  MediaAutomationProvider,
  MediaAutomationRequest,
  MediaExternalReference,
  MediaLibraryCatalogItem,
  MediaLibraryMatch,
  MediaLibraryPoster,
  MediaLibraryProvider,
  MediaMetadataSnapshot,
  MediaProviderHealth,
  MediaServerUser,
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

const ALLOWED_POSTER_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_POSTER_BYTES = 10 * 1024 * 1024;

async function fetchPoster(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<MediaLibraryPoster> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new MediaConnectorError(
        `海报服务返回 HTTP ${response.status}`,
        response.status,
      );
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_POSTER_TYPES.has(contentType)) {
      throw new MediaConnectorError('海报服务返回了不支持的文件类型');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_POSTER_BYTES) {
      throw new MediaConnectorError('海报文件过大');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > MAX_POSTER_BYTES) {
      throw new MediaConnectorError(body.length ? '海报文件过大' : '海报文件为空');
    }
    return { body, contentType };
  } catch (error) {
    if (error instanceof MediaConnectorError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaConnectorError('海报读取超时');
    }
    throw new MediaConnectorError('无法读取海报');
  } finally {
    clearTimeout(timeout);
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

function plexExternalRefs(item: JsonRecord, mediaType: MediaType) {
  return asArray(item.Guid)
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
          mediaType,
          externalId: match[2],
        },
      ];
    });
}

function integerOrNull(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function sortedUniqueUsers(users: MediaServerUser[]) {
  const byId = new Map<string, MediaServerUser>();
  for (const user of users) byId.set(user.externalUserId, user);
  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN'),
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

  async listItems(): Promise<MediaLibraryCatalogItem[]> {
    const sectionsBody = asRecord(await this.request('/library/sections'));
    const sections = asArray(asRecord(sectionsBody.MediaContainer).Directory)
      .map(asRecord)
      .filter((section) => section.type === 'movie' || section.type === 'show');
    const result: MediaLibraryCatalogItem[] = [];
    const pageSize = 200;
    for (const section of sections) {
      const sectionKey = asString(section.key);
      if (!sectionKey) continue;
      let start = 0;
      while (start < 20_000) {
        const params = new URLSearchParams({
          includeGuids: '1',
          'X-Plex-Container-Start': String(start),
          'X-Plex-Container-Size': String(pageSize),
        });
        const pageBody = asRecord(
          await this.request(`/library/sections/${encodeURIComponent(sectionKey)}/all`, params),
        );
        const container = asRecord(pageBody.MediaContainer);
        const items = [
          ...asArray(container.Metadata),
          ...asArray(container.Video),
          ...asArray(container.Directory),
        ].map(asRecord);
        for (const item of items) {
          const libraryItemId = asString(item.ratingKey) ?? asString(item.key);
          const title = asString(item.title);
          if (!libraryItemId || !title) continue;
          const type: MediaType = item.type === 'show' ? 'series' : 'movie';
          result.push({
            libraryItemId: libraryItemId.replace(/^\/library\/metadata\//, ''),
            type,
            title,
            originalTitle: asString(item.originalTitle),
            year: integerOrNull(item.year),
            overview: asString(item.summary),
            posterUrl: null,
            externalRefs: plexExternalRefs(item, type),
            playbackUrl: await this.getPlaybackTarget(
              libraryItemId.replace(/^\/library\/metadata\//, ''),
            ),
            metadata: {
              sectionKey,
              sectionTitle: asString(section.title),
              thumb: asString(item.thumb),
              addedAt: integerOrNull(item.addedAt),
              updatedAt: integerOrNull(item.updatedAt),
            },
          });
        }
        const total = integerOrNull(container.totalSize) ?? integerOrNull(container.total);
        start += items.length;
        if (!items.length || items.length < pageSize || (total != null && start >= total)) {
          break;
        }
      }
    }
    return result;
  }

  async listUsers() {
    const [identity, body] = await Promise.all([
      this.getIdentity(),
      this.request('/accounts'),
    ]);
    const container = asRecord(asRecord(body).MediaContainer);
    const users = asArray(container.Account)
      .map(asRecord)
      .flatMap<MediaServerUser>((account) => {
        const externalUserId = asString(account.id) ?? asString(account.key);
        const name = asString(account.name) ?? asString(account.title);
        if (!externalUserId || !name) return [];
        return [{ externalUserId, name, isDisabled: false }];
      });
    return {
      serverId: identity.machineIdentifier,
      users: sortedUniqueUsers(users),
    };
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
      const itemRefs = plexExternalRefs(
        item,
        item.type === 'show' ? 'series' : 'movie',
      );
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

  async getPoster(
    _libraryItemId: string,
    metadata: Record<string, unknown>,
  ) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 Token');
    }
    const thumb = asString(metadata.thumb);
    if (!thumb?.startsWith('/')) return null;
    const posterUrl = buildUrl(this.config.baseUrl, thumb);
    if (posterUrl.origin !== new URL(this.config.baseUrl).origin) return null;
    return fetchPoster(
      this.fetcher,
      posterUrl,
      { headers: this.headers() },
    );
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

  async listItems(): Promise<MediaLibraryCatalogItem[]> {
    const result: MediaLibraryCatalogItem[] = [];
    const pageSize = 200;
    let start = 0;
    while (start < 20_000) {
      const params = new URLSearchParams({
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Series',
        Fields: 'ProviderIds,Overview,OriginalTitle,DateCreated,ImageTags',
        StartIndex: String(start),
        Limit: String(pageSize),
      });
      const body = asRecord(await this.request('/Items', params));
      const items = asArray(body.Items).map(asRecord);
      for (const item of items) {
        const libraryItemId = asString(item.Id);
        const title = asString(item.Name);
        if (!libraryItemId || !title) continue;
        const type: MediaType = item.Type === 'Series' ? 'series' : 'movie';
        const providerIds = asRecord(item.ProviderIds);
        const externalRefs: MediaExternalReference[] = [];
        const tmdbId = asString(providerIds.Tmdb);
        const imdbId = asString(providerIds.Imdb);
        if (tmdbId) externalRefs.push({ provider: 'tmdb', mediaType: type, externalId: tmdbId });
        if (imdbId) externalRefs.push({ provider: 'imdb', mediaType: type, externalId: imdbId });
        result.push({
          libraryItemId,
          type,
          title,
          originalTitle: asString(item.OriginalTitle),
          year: integerOrNull(item.ProductionYear),
          overview: asString(item.Overview),
          posterUrl: null,
          externalRefs,
          playbackUrl: await this.getPlaybackTarget(libraryItemId),
          metadata: {
            dateCreated: asString(item.DateCreated),
            imageTags: asRecord(item.ImageTags),
          },
        });
      }
      const total = integerOrNull(body.TotalRecordCount);
      start += items.length;
      if (!items.length || items.length < pageSize || (total != null && start >= total)) break;
    }
    return result;
  }

  async listUsers() {
    const [info, body] = await Promise.all([
      this.getServerInfo(),
      this.request('/Users'),
    ]);
    const values = Array.isArray(body)
      ? body
      : asArray(asRecord(body).Items);
    const users = values.map(asRecord).flatMap<MediaServerUser>((account) => {
      const externalUserId = asString(account.Id);
      const name = asString(account.Name);
      if (!externalUserId || !name) return [];
      return [
        {
          externalUserId,
          name,
          isDisabled: asRecord(account.Policy).IsDisabled === true,
        },
      ];
    });
    return { serverId: info.id, users: sortedUniqueUsers(users) };
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

  async getPoster(
    libraryItemId: string,
    metadata: Record<string, unknown>,
  ) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 API Key');
    }
    const primaryTag = asString(asRecord(metadata.imageTags).Primary);
    if (!primaryTag) return null;
    const params = new URLSearchParams({ maxWidth: '500', quality: '90' });
    return fetchPoster(
      this.fetcher,
      buildUrl(
        this.config.baseUrl,
        `/Items/${encodeURIComponent(libraryItemId)}/Images/Primary`,
        params,
      ),
      {
        headers: {
          Accept: 'image/avif,image/webp,image/jpeg,image/png',
          'X-Emby-Token': this.config.credential,
        },
      },
    );
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

interface MoviePilotMediaIdentity {
  mediaType: MediaType;
  tmdbId: string;
  season?: number;
}

interface MoviePilotDownload extends JsonRecord {
  downloader?: string;
  hash?: string;
  progress?: number;
  media?: JsonRecord;
}

interface MoviePilotDownloadHistory extends JsonRecord {
  tmdbid?: number;
  seasons?: string;
}

interface MoviePilotTransferHistory extends MoviePilotDownloadHistory {
  id?: number;
  download_hash?: string;
  status?: boolean;
  errmsg?: string;
  date?: string;
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
    timeoutMs = 10000,
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
      timeoutMs,
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
    const mediaType = media.type === 'movie' ? '电影' : '电视剧';
    let response: JsonRecord;
    try {
      response = asRecord(
        await this.request(
          '/api/v1/subscribe/',
          {
            method: 'POST',
            body: JSON.stringify({
              name: media.title,
              year: media.year ? String(media.year) : undefined,
              type: mediaType,
              tmdbid: Number(tmdb.externalId),
              season,
            }),
          },
          undefined,
          30000,
        ),
      );
    } catch (error) {
      if (
        !(error instanceof MediaConnectorError) ||
        error.message !== '连接超时'
      ) {
        throw error;
      }

      // The POST may have completed in MoviePilot after the client timed out.
      try {
        const existing = await this.findSubscription(media, options);
        if (existing) return existing;
      } catch {
        // Preserve the actionable timeout below when confirmation also fails.
      }
      throw new MediaConnectorError(
        '订阅提交响应超时，请稍后重新提交以确认结果',
      );
    }
    if (response.success !== true) {
      throw new MediaConnectorError(
        asString(response.message) ?? 'MoviePilot 创建订阅失败',
      );
    }
    const id = asString(asRecord(response.data).id);
    if (!id) throw new MediaConnectorError('MoviePilot 未返回订阅编号');
    return this.present(
      {
        id: Number(id),
        state: 'N',
        type: mediaType,
        tmdbid: Number(tmdb.externalId),
      },
      media.externalRefs,
    );
  }

  async findRequest(
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest | null> {
    const identity = this.mediaIdentity(media, options);
    const subscription = await this.findSubscription(media, options);
    if (subscription) return subscription;
    return this.findMediaActivity(identity, media.externalRefs);
  }

  private async findSubscription(
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest | null> {
    const identity = this.mediaIdentity(media, options);
    const body = asRecord(
      await this.request(
        `/api/v1/subscribe/media/${encodeURIComponent(`themoviedb:${identity.tmdbId}`)}`,
        {},
        identity.season
          ? new URLSearchParams({ season: String(identity.season) })
          : undefined,
      ),
    ) as MoviePilotSubscription;
    return body.id ? this.present(body, media.externalRefs) : null;
  }

  private mediaIdentity(
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): MoviePilotMediaIdentity {
    const tmdb = media.externalRefs.find(
      (reference) => reference.provider === 'tmdb',
    );
    if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
      throw new MediaConnectorError('查找 MoviePilot 订阅需要有效的 TMDB ID');
    }
    const season = media.type === 'series' ? options.season : undefined;
    if (media.type === 'series' && (!season || season < 1)) {
      throw new MediaConnectorError('查找剧集订阅需要选择季数');
    }
    return {
      mediaType: media.type,
      tmdbId: tmdb.externalId,
      season,
    };
  }

  async getRequest(requestId: string): Promise<MediaAutomationRequest | null> {
    const mediaRequest = this.parseMediaRequestId(requestId);
    if (mediaRequest) {
      return this.findMediaActivity(mediaRequest, [
        {
          provider: 'tmdb',
          mediaType: mediaRequest.mediaType,
          externalId: mediaRequest.tmdbId,
        },
      ]);
    }
    const body = asRecord(
      await this.request(
        `/api/v1/subscribe/${encodeURIComponent(requestId)}`,
      ),
    );
    if (!body.id) return null;
    return this.present(body as MoviePilotSubscription, []);
  }

  async cancelRequest(requestId: string): Promise<MediaAutomationRequest> {
    const mediaRequest = this.parseMediaRequestId(requestId);
    if (mediaRequest) return this.cancelDownloads(mediaRequest);
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

  private mediaRequestId(
    stage: 'download' | 'history' | 'transfer',
    identity: MoviePilotMediaIdentity,
  ) {
    return `media-${stage}:${identity.mediaType}:${identity.tmdbId}:${identity.season ?? 0}`;
  }

  private parseMediaRequestId(
    requestId: string,
  ): MoviePilotMediaIdentity | null {
    const match = /^media-(?:download|history|transfer):(movie|series):(\d+):(\d+)$/.exec(
      requestId,
    );
    if (!match) return null;
    const season = Number(match[3]);
    return {
      mediaType: match[1] as MediaType,
      tmdbId: match[2],
      season: season > 0 ? season : undefined,
    };
  }

  private matchesIdentity(
    identity: MoviePilotMediaIdentity,
    tmdbId: unknown,
    season: unknown,
  ) {
    if (String(tmdbId ?? '') !== identity.tmdbId) return false;
    if (identity.mediaType === 'movie') return true;
    const numericSeason = integerOrNull(season);
    if (numericSeason != null) return numericSeason === identity.season;
    const seasonMatch = /S(\d+)/i.exec(asString(season) ?? '');
    return seasonMatch ? Number(seasonMatch[1]) === identity.season : false;
  }

  private async downloads(identity: MoviePilotMediaIdentity) {
    return asArray(await this.request('/api/v1/download/'))
      .map((value) => asRecord(value) as MoviePilotDownload)
      .filter((download) => {
        const media = asRecord(download.media);
        return this.matchesIdentity(
          identity,
          media.tmdbid ?? media.tmdb_id,
          media.season,
        );
      });
  }

  private async transferHistory(identity: MoviePilotMediaIdentity) {
    const response = asRecord(
      await this.request(
        '/api/v1/history/transfer',
        {},
        new URLSearchParams({ page: '1', count: '1000' }),
      ),
    );
    return asArray(asRecord(response.data).list)
      .map((value) => asRecord(value) as MoviePilotTransferHistory)
      .filter(
        (history) =>
          this.matchesIdentity(
            identity,
            history.tmdbid,
            history.seasons,
          ),
      );
  }

  private latestTransferBatch(histories: MoviePilotTransferHistory[]) {
    if (histories.length < 2) return histories;
    const newest = [...histories].sort((left, right) => {
      const idDifference =
        (integerOrNull(right.id) ?? 0) - (integerOrNull(left.id) ?? 0);
      if (idDifference) return idDifference;
      return (asString(right.date) ?? '').localeCompare(
        asString(left.date) ?? '',
      );
    })[0];
    const downloadHash = asString(newest.download_hash);
    return downloadHash
      ? histories.filter(
          (history) => asString(history.download_hash) === downloadHash,
        )
      : histories;
  }

  private transferFailureReason(histories: MoviePilotTransferHistory[]) {
    const message = histories
      .map((history) => asString(history.errmsg)?.trim())
      .find((value): value is string => Boolean(value));
    if (!message) return null;
    if (message.includes('已存在')) return '目标文件已存在';
    return message.slice(0, 160);
  }

  private async downloadHistory(identity: MoviePilotMediaIdentity) {
    return asArray(
      await this.request(
        '/api/v1/history/download',
        {},
        new URLSearchParams({ page: '1', count: '1000' }),
      ),
    )
      .map((value) => asRecord(value) as MoviePilotDownloadHistory)
      .filter((history) =>
        this.matchesIdentity(identity, history.tmdbid, history.seasons),
      );
  }

  private async findMediaActivity(
    identity: MoviePilotMediaIdentity,
    externalRefs: MediaExternalReference[],
  ): Promise<MediaAutomationRequest | null> {
    const downloads = await this.downloads(identity);
    if (downloads.length) {
      const progress = Math.max(
        ...downloads.map((download) => Number(download.progress) || 0),
      );
      return {
        requestId: this.mediaRequestId('download', identity),
        status: 'processing',
        externalRefs,
        updatedAt: new Date(),
        message: `MoviePilot 下载中 · ${Math.round(progress)}%${downloads.length > 1 ? ` · ${downloads.length} 个任务` : ''}`,
      };
    }
    const transfers = this.latestTransferBatch(
      await this.transferHistory(identity),
    );
    const successfulTransfers = transfers.filter(
      (transfer) => transfer.status === true,
    );
    const failedTransfers = transfers.filter(
      (transfer) => transfer.status !== true,
    );
    if (failedTransfers.length) {
      const reason = this.transferFailureReason(failedTransfers);
      return {
        requestId: this.mediaRequestId('transfer', identity),
        status: 'failed',
        externalRefs,
        updatedAt: new Date(),
        message: `MoviePilot 整理不完整 · ${successfulTransfers.length} 成功 / ${failedTransfers.length} 失败${reason ? ` · ${reason}` : ''}`,
      };
    }
    if (successfulTransfers.length) {
      return {
        requestId: this.mediaRequestId('transfer', identity),
        status: 'completed',
        externalRefs,
        updatedAt: new Date(),
        message: 'MoviePilot 已完成整理',
      };
    }
    const history = await this.downloadHistory(identity);
    if (history.length) {
      return {
        requestId: this.mediaRequestId('history', identity),
        status: 'processing',
        externalRefs,
        updatedAt: new Date(),
        message: 'MoviePilot 已接收下载，等待整理完成',
      };
    }
    return null;
  }

  private async cancelDownloads(
    identity: MoviePilotMediaIdentity,
  ): Promise<MediaAutomationRequest> {
    const downloads = await this.downloads(identity);
    if (!downloads.length) {
      throw new MediaConnectorError('MoviePilot 中没有可取消的活动下载任务');
    }
    for (const download of downloads) {
      if (!download.hash) {
        throw new MediaConnectorError('MoviePilot 下载任务缺少任务编号');
      }
      const response = asRecord(
        await this.request(
          `/api/v1/download/${encodeURIComponent(download.hash)}`,
          { method: 'DELETE' },
          download.downloader
            ? new URLSearchParams({ name: download.downloader })
            : undefined,
        ),
      );
      if (response.success !== true) {
        throw new MediaConnectorError(
          asString(response.message) ?? '取消 MoviePilot 下载任务失败',
        );
      }
    }
    return {
      requestId: this.mediaRequestId('download', identity),
      status: 'cancelled',
      externalRefs: [
        {
          provider: 'tmdb',
          mediaType: identity.mediaType,
          externalId: identity.tmdbId,
        },
      ],
      updatedAt: new Date(),
    };
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
