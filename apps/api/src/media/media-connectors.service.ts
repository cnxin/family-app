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
  MediaLibraryMatch,
  MediaLibraryProvider,
  MediaMetadataSnapshot,
  MediaProviderHealth,
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

  async getRequest(
    householdId: string,
    connectorKey: string,
    requestId: string,
  ): Promise<MediaAutomationRequest | null> {
    return (await this.automation(householdId, connectorKey)).getRequest(
      requestId,
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
