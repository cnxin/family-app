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
  JsonRecord,
  MediaConnectorError,
  asRecord,
  asArray,
  asString,
  buildUrl,
  fetchJson,
  fetchPoster,
  healthFailure,
  externalRefKey,
  relevantExternalRefs,
  integerOrNull,
  requestedSeasons,
  sortedUniqueUsers,
} from './connectors';

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
    options: { seasons?: number[] } = {},
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
    const seasons = requestedSeasons(options);
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
      const mediaType: MediaType = item.type === 'show' ? 'series' : 'movie';
      matches.push({
        libraryItemId,
        externalRefs: [
          ...itemRefs,
          {
            provider: 'plex',
            mediaType,
            externalId: libraryItemId,
            connectorKey: this.config.key,
          },
        ],
        available: true,
        playbackUrl: await this.getPlaybackTarget(libraryItemId),
        seasons:
          mediaType === 'series' && seasons.length
            ? await this.seasonsForShow(libraryItemId, seasons)
            : [],
        metadata: {
          title: asString(item.title),
          year: item.year ?? null,
        },
      });
    }
    return matches;
  }

  private async seasonsForShow(libraryItemId: string, seasons: number[]) {
    const body = asRecord(
      await this.request(
        `/library/metadata/${encodeURIComponent(libraryItemId)}/children`,
      ),
    );
    const container = asRecord(body.MediaContainer);
    const requested = new Set(seasons);
    return [
      ...asArray(container.Metadata),
      ...asArray(container.Directory),
    ]
      .map(asRecord)
      .flatMap((item) => {
        const season = integerOrNull(item.index);
        if (item.type !== 'season' || season == null || !requested.has(season)) {
          return [];
        }
        const episodeCount = integerOrNull(item.leafCount);
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
