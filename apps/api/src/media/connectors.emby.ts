import {
  MediaExternalProvider,
  MediaType,
} from '../entities';
import {
  MediaExternalReference,
  MediaLibraryCatalogItem,
  MediaLibraryMatch,
  MediaLibraryProvider,
  MediaProviderHealth,
  MediaServerUser,
} from './providers';
import { MediaConnectorConfig } from './connectors.config';
import {
  Fetcher,
  MediaConnectorError,
  asRecord,
  asArray,
  asString,
  buildUrl,
  fetchJson,
  fetchPoster,
  healthFailure,
  relevantExternalRefs,
  integerOrNull,
  requestedSeasons,
  sortedUniqueUsers,
} from './connectors';

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
    options: { seasons?: number[] } = {},
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
    const seasons = requestedSeasons(options);
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
        seasons:
          mediaType === 'series' && seasons.length
            ? await this.seasonsForSeries(libraryItemId, seasons)
            : [],
        metadata: {
          title: asString(item.Name),
          productionYear: item.ProductionYear ?? null,
        },
      });
    }
    return matches;
  }

  private async seasonsForSeries(libraryItemId: string, seasons: number[]) {
    const body = asRecord(
      await this.request(
        `/Shows/${encodeURIComponent(libraryItemId)}/Seasons`,
        new URLSearchParams({ Fields: 'ChildCount,IndexNumber' }),
      ),
    );
    const requested = new Set(seasons);
    return asArray(body.Items)
      .map(asRecord)
      .flatMap((item) => {
        const season = integerOrNull(item.IndexNumber);
        if (season == null || !requested.has(season)) return [];
        const episodeCount = integerOrNull(item.ChildCount);
        return [
          {
            season,
            episodeCount:
              episodeCount != null && episodeCount >= 0 ? episodeCount : null,
          },
        ];
      })
      .sort((left, right) => left.season - right.season);
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
