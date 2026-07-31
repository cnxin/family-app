import { Injectable } from '@nestjs/common';
import { IntegrationKind } from '../entities';
import { MediaConnectorConfig } from './connectors.config';
import {
  EmbyLibraryProvider,
  MediaConnectorError,
  MoviePilotAutomationProvider,
  PlexLibraryProvider,
  connectorRole,
} from './connectors';
import { IntegrationSettingsService } from './integration-settings.service';
import {
  MediaAutomationRequest,
  MediaAutomationProvider,
  MediaExternalReference,
  MediaLibraryCatalogItem,
  MediaLibraryMatch,
  MediaLibraryPoster,
  MediaLibraryProvider,
  MediaMetadataSnapshot,
  MediaProviderHealth,
  MediaServerUser,
} from './providers';

export interface PublicMediaConnector {
  key: string;
  kind: MediaConnectorConfig['kind'];
  name: string;
  role: 'library' | 'automation';
  primary: boolean;
  state:
    | 'disabled'
    | 'not_configured'
    | 'needs_credential'
    | 'online'
    | 'offline';
  available: boolean;
  message: string;
  checkedAt: Date | null;
}

export interface PublicLibraryMatch {
  connectorKey: string;
  provider: 'plex' | 'emby';
  name: string;
  primary: boolean;
  libraryItemId: string;
  playbackUrl: string | null;
}

interface LibraryConnector {
  config: MediaConnectorConfig;
  provider: MediaLibraryProvider;
}

export interface MediaLibraryScan {
  connectorKey: string;
  provider: 'plex' | 'emby';
  name: string;
  primary: boolean;
  items: MediaLibraryCatalogItem[];
}

export interface PublicMediaPlaybackUserDirectory {
  connectorKey: string;
  provider: 'plex' | 'emby';
  name: string;
  state: PublicMediaConnector['state'];
  message: string;
  serverId: string | null;
  users: MediaServerUser[];
}

interface ConnectorContext {
  configs: MediaConnectorConfig[];
  libraries: LibraryConnector[];
  moviePilot: MoviePilotAutomationProvider | null;
  version: string;
}

interface TimedValue<T> {
  expiresAt: number;
  value: Promise<T>;
}

@Injectable()
export class MediaConnectorsService {
  private readonly healthCache = new Map<
    string,
    TimedValue<MediaProviderHealth>
  >();
  private readonly availabilityCache = new Map<
    string,
    TimedValue<MediaLibraryMatch[]>
  >();

  constructor(private readonly settings: IntegrationSettingsService) {}

  async status(
    householdId: string,
    refresh = false,
  ): Promise<PublicMediaConnector[]> {
    const context = await this.context(householdId);
    return Promise.all(
      context.configs.map(async (config) => {
        if (config.enabled === false) {
          return this.publicStatus(config, 'disabled', '此家庭已停用');
        }
        if (!config.baseUrl) {
          return this.publicStatus(config, 'not_configured', '未配置服务地址');
        }
        if (!config.credential) {
          return this.publicStatus(
            config,
            'needs_credential',
            config.kind === 'plex' ? '等待配置 Token' : '等待配置 API Key',
          );
        }
        const provider = this.provider(context, config.kind);
        const health = await this.health(
          householdId,
          context.version,
          config,
          provider,
          refresh,
        );
        return {
          key: config.key,
          kind: config.kind,
          name: config.name,
          role: connectorRole(config.kind),
          primary: config.primary,
          state: health.available ? ('online' as const) : ('offline' as const),
          available: health.available,
          message: health.message ?? (health.available ? '已连接' : '连接失败'),
          checkedAt: health.checkedAt,
        };
      }),
    );
  }

  async test(householdId: string, kind: IntegrationKind) {
    const statuses = await this.status(householdId, true);
    const status = statuses.find((item) => item.kind === kind);
    if (!status) throw new MediaConnectorError('媒体服务不存在');
    return status;
  }

  async availability(
    householdId: string,
    media: { id: string; externalRefs: MediaExternalReference[] }[],
  ): Promise<Record<string, PublicLibraryMatch[]>> {
    const context = await this.context(householdId);
    const result = Object.fromEntries(media.map((entry) => [entry.id, []])) as Record<
      string,
      PublicLibraryMatch[]
    >;
    const healthyLibraries = (
      await Promise.all(
        context.libraries.map(async (library) => ({
          library,
          health: await this.health(
            householdId,
            context.version,
            library.config,
            library.provider,
          ),
        })),
      )
    ).filter((entry) => entry.health.available);

    await Promise.all(
      media.flatMap((entry) =>
        healthyLibraries.map(async ({ library }) => {
          const matches: MediaLibraryMatch[] = await this.matches(
            householdId,
            context.version,
            library,
            entry.externalRefs,
          ).catch((): MediaLibraryMatch[] => []);
          result[entry.id].push(
            ...matches
              .filter((match) => match.available)
              .map((match) => ({
                connectorKey: library.config.key,
                provider: library.config.kind as 'plex' | 'emby',
                name: library.config.name,
                primary: library.config.primary,
                libraryItemId: match.libraryItemId,
                playbackUrl: match.playbackUrl,
              })),
          );
        }),
      ),
    );
    for (const matches of Object.values(result)) {
      matches.sort(
        (left, right) =>
          Number(right.primary) - Number(left.primary) ||
          left.name.localeCompare(right.name, 'zh-CN'),
      );
    }
    return result;
  }

  async requestMedia(
    householdId: string,
    connectorKey: string,
    media: MediaMetadataSnapshot,
    idempotencyKey: string,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest> {
    return (
      await this.automation(householdId, connectorKey)
    ).requestMedia(media, idempotencyKey, options);
  }

  async scanLibraries(
    householdId: string,
    connectorKey?: string,
  ): Promise<MediaLibraryScan[]> {
    const context = await this.context(householdId);
    const targets = connectorKey
      ? context.libraries.filter((library) => library.config.key === connectorKey)
      : context.libraries;
    if (!targets.length) {
      throw new MediaConnectorError(
        connectorKey ? '指定的媒体库尚未配置或未启用' : '尚未配置可用的媒体库',
      );
    }
    return Promise.all(
      targets.map(async ({ config, provider }) => ({
        connectorKey: config.key,
        provider: config.kind as 'plex' | 'emby',
        name: config.name,
        primary: config.primary,
        items: await provider.listItems(),
      })),
    );
  }

  async playbackUsers(
    householdId: string,
    connectorKey?: string,
  ): Promise<PublicMediaPlaybackUserDirectory[]> {
    const context = await this.context(householdId);
    const configs = context.configs.filter(
      (config) =>
        (config.kind === 'plex' || config.kind === 'emby') &&
        (!connectorKey || config.key === connectorKey),
    );
    if (connectorKey && !configs.length) {
      throw new MediaConnectorError('指定的媒体库不存在');
    }
    return Promise.all(
      configs.map(async (config): Promise<PublicMediaPlaybackUserDirectory> => {
        const base = {
          connectorKey: config.key,
          provider: config.kind as 'plex' | 'emby',
          name: config.name,
          serverId: null,
          users: [],
        };
        if (config.enabled === false) {
          return { ...base, state: 'disabled', message: '此家庭已停用' };
        }
        if (!config.baseUrl) {
          return { ...base, state: 'not_configured', message: '未配置服务地址' };
        }
        if (!config.credential) {
          return {
            ...base,
            state: 'needs_credential',
            message: config.kind === 'plex' ? '等待配置 Token' : '等待配置 API Key',
          };
        }
        const library = context.libraries.find(
          (entry) => entry.config.key === config.key,
        );
        if (!library) {
          return { ...base, state: 'offline', message: '连接器不可用' };
        }
        try {
          const directory = await library.provider.listUsers();
          return {
            ...base,
            state: 'online',
            message: `已读取 ${directory.users.length} 个用户`,
            serverId: directory.serverId,
            users: directory.users,
          };
        } catch (error) {
          return {
            ...base,
            state: 'offline',
            message: error instanceof Error ? error.message : '读取用户失败',
          };
        }
      }),
    );
  }

  async getLibraryPoster(
    householdId: string,
    connectorKey: string,
    libraryItemId: string,
    metadata: Record<string, unknown>,
  ): Promise<MediaLibraryPoster | null> {
    const context = await this.context(householdId);
    const library = context.libraries.find(
      (entry) => entry.config.key === connectorKey,
    );
    if (!library) throw new MediaConnectorError('媒体库尚未配置或已停用');
    return library.provider.getPoster(libraryItemId, metadata);
  }

  async getRequest(
    householdId: string,
    connectorKey: string,
    requestId: string,
  ): Promise<MediaAutomationRequest | null> {
    return (await this.automation(householdId, connectorKey)).getRequest(
      requestId,
    );
  }

  async findRequest(
    householdId: string,
    connectorKey: string,
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest | null> {
    return (await this.automation(householdId, connectorKey)).findRequest(
      media,
      options,
    );
  }

  async cancelRequest(
    householdId: string,
    connectorKey: string,
    requestId: string,
  ): Promise<MediaAutomationRequest> {
    return (await this.automation(householdId, connectorKey)).cancelRequest(
      requestId,
    );
  }

  clearHouseholdCache(householdId: string) {
    for (const key of this.healthCache.keys()) {
      if (key.startsWith(`${householdId}:`)) this.healthCache.delete(key);
    }
    for (const key of this.availabilityCache.keys()) {
      if (key.startsWith(`${householdId}:`)) this.availabilityCache.delete(key);
    }
  }

  private async context(householdId: string): Promise<ConnectorContext> {
    const resolved = await this.settings.resolve(householdId);
    const active = resolved.configs.filter((config) => config.enabled !== false);
    const libraries = active
      .filter(
        (config) =>
          (config.kind === 'plex' || config.kind === 'emby') &&
          config.baseUrl &&
          config.credential,
      )
      .map((config) => ({
        config,
        provider:
          config.kind === 'plex'
            ? new PlexLibraryProvider(config)
            : new EmbyLibraryProvider(config),
      }));
    const moviePilotConfig = active.find(
      (config) =>
        config.kind === 'moviepilot' && config.baseUrl && config.credential,
    );
    return {
      configs: resolved.configs,
      libraries,
      moviePilot: moviePilotConfig
        ? new MoviePilotAutomationProvider(moviePilotConfig)
        : null,
      version: resolved.version,
    };
  }

  private publicStatus(
    config: MediaConnectorConfig,
    state: PublicMediaConnector['state'],
    message: string,
  ): PublicMediaConnector {
    return {
      key: config.key,
      kind: config.kind,
      name: config.name,
      role: connectorRole(config.kind),
      primary: config.primary,
      state,
      available: false,
      message,
      checkedAt: null,
    };
  }

  private async automation(householdId: string, connectorKey: string) {
    const context = await this.context(householdId);
    if (
      !context.moviePilot ||
      context.moviePilot.config.key !== connectorKey
    ) {
      throw new MediaConnectorError('MoviePilot 尚未配置或未启用');
    }
    return context.moviePilot;
  }

  private provider(
    context: ConnectorContext,
    kind: IntegrationKind,
  ): MediaLibraryProvider | MediaAutomationProvider | null {
    return (
      context.libraries.find((item) => item.config.kind === kind)?.provider ??
      (kind === 'moviepilot' ? context.moviePilot : null)
    );
  }

  private health(
    householdId: string,
    version: string,
    config: MediaConnectorConfig,
    provider: MediaLibraryProvider | MediaAutomationProvider | null,
    refresh = false,
  ) {
    const key = `${householdId}:${version}:${config.key}`;
    const current = this.healthCache.get(key);
    if (!refresh && current && current.expiresAt > Date.now()) {
      return current.value;
    }
    const value = provider
      ? provider.health()
      : Promise.resolve({
          available: false,
          checkedAt: new Date(),
          message: '连接器未启用',
        });
    this.healthCache.set(key, {
      expiresAt: Date.now() + 30_000,
      value,
    });
    return value;
  }

  private matches(
    householdId: string,
    version: string,
    library: LibraryConnector,
    refs: MediaExternalReference[],
  ): Promise<MediaLibraryMatch[]> {
    const refKey = refs
      .filter((ref) => ref.provider === 'tmdb' || ref.provider === 'imdb')
      .map((ref) => `${ref.provider}:${ref.mediaType}:${ref.externalId}`)
      .sort()
      .join('|');
    if (!refKey) return Promise.resolve([] as MediaLibraryMatch[]);
    const key = `${householdId}:${version}:${library.config.key}:${refKey}`;
    const current = this.availabilityCache.get(key);
    if (current && current.expiresAt > Date.now()) return current.value;
    const value = library.provider.findByExternalRefs(refs);
    this.availabilityCache.set(key, {
      expiresAt: Date.now() + 60_000,
      value,
    });
    return value;
  }
}
