import { MediaConnectorConfig } from './connectors.config';
import { connectorRole } from './connectors';
import { MoviePilotAutomationProvider } from './connectors.moviepilot';
import { MediaLibraryCatalogItem, MediaLibraryProvider, MediaServerUser } from './providers';

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
  seasons: {
    season: number;
    episodeCount: number | null;
  }[];
}

export interface LibraryConnector {
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

export interface ConnectorContext {
  configs: MediaConnectorConfig[];
  libraries: LibraryConnector[];
  moviePilot: MoviePilotAutomationProvider | null;
  version: string;
}

export interface TimedValue<T> {
  expiresAt: number;
  value: Promise<T>;
}

export function publicStatus(
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
