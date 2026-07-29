import { Injectable } from '@nestjs/common';
import {
  MediaConnectorConfig,
  mediaConnectorConfigs,
} from './connectors.config';
import {
  EmbyLibraryProvider,
  MoviePilotAutomationProvider,
  PlexLibraryProvider,
  connectorRole,
} from './connectors';
import {
  MediaExternalReference,
  MediaLibraryMatch,
  MediaLibraryProvider,
  MediaProviderHealth,
} from './providers';

export interface PublicMediaConnector {
  key: string;
  kind: MediaConnectorConfig['kind'];
  name: string;
  role: 'library' | 'automation';
  primary: boolean;
  state: 'not_configured' | 'needs_credential' | 'online' | 'offline';
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

interface TimedValue<T> {
  expiresAt: number;
  value: Promise<T>;
}

@Injectable()
export class MediaConnectorsService {
  private readonly configs = mediaConnectorConfigs();
  private readonly libraries: LibraryConnector[];
  readonly moviePilot: MoviePilotAutomationProvider | null;
  private readonly healthCache = new Map<string, TimedValue<MediaProviderHealth>>();
  private readonly availabilityCache = new Map<
    string,
    TimedValue<MediaLibraryMatch[]>
  >();

  constructor() {
    this.libraries = this.configs
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
    const moviePilotConfig = this.configs.find(
      (config) =>
        config.kind === 'moviepilot' && config.baseUrl && config.credential,
    );
    this.moviePilot = moviePilotConfig
      ? new MoviePilotAutomationProvider(moviePilotConfig)
      : null;
  }

  async status(refresh = false): Promise<PublicMediaConnector[]> {
    return Promise.all(
      this.configs.map(async (config) => {
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
        const health = await this.health(config, refresh);
        return {
          key: config.key,
          kind: config.kind,
          name: config.name,
          role: connectorRole(config.kind),
          primary: config.primary,
          state: health.available ? 'online' as const : 'offline' as const,
          available: health.available,
          message: health.message ?? (health.available ? '已连接' : '连接失败'),
          checkedAt: health.checkedAt,
        };
      }),
    );
  }

  async availability(
    media: { id: string; externalRefs: MediaExternalReference[] }[],
  ): Promise<Record<string, PublicLibraryMatch[]>> {
    const result = Object.fromEntries(media.map((entry) => [entry.id, []])) as Record<
      string,
      PublicLibraryMatch[]
    >;
    const healthyLibraries = (
      await Promise.all(
        this.libraries.map(async (library) => ({
          library,
          health: await this.health(library.config),
        })),
      )
    ).filter((entry) => entry.health.available);

    await Promise.all(
      media.flatMap((entry) =>
        healthyLibraries.map(async ({ library }) => {
          const matches: MediaLibraryMatch[] = await this.matches(
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

  private health(config: MediaConnectorConfig, refresh = false) {
    const current = this.healthCache.get(config.key);
    if (!refresh && current && current.expiresAt > Date.now()) {
      return current.value;
    }
    const library = this.libraries.find(
      (candidate) => candidate.config.key === config.key,
    );
    const provider =
      library?.provider ??
      (config.kind === 'moviepilot' ? this.moviePilot : null);
    const value = provider
      ? provider.health()
      : Promise.resolve({
          available: false,
          checkedAt: new Date(),
          message: '连接器未启用',
        });
    this.healthCache.set(config.key, {
      expiresAt: Date.now() + 30_000,
      value,
    });
    return value;
  }

  private matches(
    library: LibraryConnector,
    refs: MediaExternalReference[],
  ): Promise<MediaLibraryMatch[]> {
    const refKey = refs
      .filter((ref) => ref.provider === 'tmdb' || ref.provider === 'imdb')
      .map((ref) => `${ref.provider}:${ref.mediaType}:${ref.externalId}`)
      .sort()
      .join('|');
    if (!refKey) return Promise.resolve([] as MediaLibraryMatch[]);
    const key = `${library.config.key}:${refKey}`;
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
