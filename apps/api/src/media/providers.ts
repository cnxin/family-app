import {
  MediaExternalProvider,
  MediaType,
} from '../entities';

export interface MediaExternalReference {
  provider: MediaExternalProvider;
  mediaType: MediaType;
  externalId: string;
  connectorKey?: string;
}

export interface MediaMetadataSnapshot {
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  externalRefs: MediaExternalReference[];
  metadata: Record<string, unknown>;
}

export interface MediaSearchQuery {
  query: string;
  type?: MediaType;
  year?: number;
}

export interface MediaProviderHealth {
  available: boolean;
  checkedAt: Date;
  message?: string;
}

export interface MediaMetadataProvider {
  readonly provider: MediaExternalProvider;
  search(query: MediaSearchQuery): Promise<MediaMetadataSnapshot[]>;
  get(reference: MediaExternalReference): Promise<MediaMetadataSnapshot | null>;
  health(): Promise<MediaProviderHealth>;
}

export interface MediaAutomationRequest {
  requestId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  externalRefs: MediaExternalReference[];
  updatedAt: Date;
  message?: string;
}

export interface MediaAutomationProvider {
  readonly provider: MediaExternalProvider;
  requestMedia(
    media: MediaMetadataSnapshot,
    idempotencyKey: string,
    options?: { season?: number },
  ): Promise<MediaAutomationRequest>;
  findRequest(
    media: MediaMetadataSnapshot,
    options?: { season?: number },
  ): Promise<MediaAutomationRequest | null>;
  getRequest(requestId: string): Promise<MediaAutomationRequest | null>;
  cancelRequest(requestId: string): Promise<MediaAutomationRequest>;
  health(): Promise<MediaProviderHealth>;
}

export interface MediaLibraryMatch {
  libraryItemId: string;
  externalRefs: MediaExternalReference[];
  available: boolean;
  playbackUrl: string | null;
  metadata: Record<string, unknown>;
  seasons: MediaLibrarySeasonAvailability[];
}

export interface MediaLibrarySeasonAvailability {
  season: number;
  // This is the number found on the media server, not an expected episode count.
  episodeCount: number | null;
}

export interface MediaLibraryCatalogItem {
  libraryItemId: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  externalRefs: MediaExternalReference[];
  playbackUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface MediaLibraryPoster {
  body: Buffer;
  contentType: string;
}

export interface MediaServerUser {
  externalUserId: string;
  name: string;
  isDisabled: boolean;
}

export interface MediaServerUserDirectory {
  serverId: string;
  users: MediaServerUser[];
}

export interface MediaLibraryProvider {
  readonly provider: MediaExternalProvider;
  listItems(): Promise<MediaLibraryCatalogItem[]>;
  listUsers(): Promise<MediaServerUserDirectory>;
  findByExternalRefs(
    externalRefs: MediaExternalReference[],
    options?: { seasons?: number[] },
  ): Promise<MediaLibraryMatch[]>;
  getPoster(
    libraryItemId: string,
    metadata: Record<string, unknown>,
  ): Promise<MediaLibraryPoster | null>;
  getPlaybackTarget(libraryItemId: string): Promise<string | null>;
  health(): Promise<MediaProviderHealth>;
}
