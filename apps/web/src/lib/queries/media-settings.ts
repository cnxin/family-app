import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MediaConnectorKind,
  MediaConnectorSettings,
  MediaConnectorSummary,
  MediaCredentialKind,
  MediaLibraryProviderKind,
  MediaMetadataSource,
  MediaPlaybackUserDirectory,
  MediaSourceConfig,
  MoviePilotWebhookResult,
  PlaybackWebhookResult,
} from '@family/contracts';
import { api } from '../api';

/** 凭据只写不读：后端永远只回「配没配」和一小段提示，不回明文。 */
export function useMediaConnectorSettings() {
  return useQuery({
    queryKey: ['media-connector-settings'],
    queryFn: () => api<MediaConnectorSettings[]>('/media/connector-settings'),
  });
}

export function useMediaSourceSettings() {
  return useQuery({
    queryKey: ['media-metadata-sources'],
    queryFn: () => api<MediaSourceConfig[]>('/media/metadata-sources'),
  });
}

export function useMediaPlaybackUsers() {
  return useQuery({
    queryKey: ['media-playback-users'],
    queryFn: () => api<MediaPlaybackUserDirectory[]>('/media/playback-users'),
  });
}

function useSettingsMutation<TInput, TResult>(
  run: (input: TInput) => Promise<TResult>,
  keys: string[],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      for (const key of [...keys, 'media-connectors']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export interface ConnectorSettingsBody {
  name?: string;
  isEnabled?: boolean;
  baseUrl?: string | null;
  credential?: string;
  clearCredential?: boolean;
  isPrimary?: boolean;
}

export function useSaveConnectorSettings() {
  return useSettingsMutation<
    { kind: MediaConnectorKind; body: ConnectorSettingsBody },
    MediaConnectorSettings[]
  >(
    ({ kind, body }) =>
      api<MediaConnectorSettings[]>(`/media/connector-settings/${kind}`, { method: 'PUT', body }),
    ['media-connector-settings'],
  );
}

export function useResetConnectorSettings() {
  return useSettingsMutation<MediaConnectorKind, MediaConnectorSettings[]>(
    (kind) =>
      api<MediaConnectorSettings[]>(`/media/connector-settings/${kind}`, { method: 'DELETE' }),
    ['media-connector-settings'],
  );
}

/** 测一下：后端会强制刷新那个连接器的状态再回传。 */
export function useTestConnector() {
  return useSettingsMutation<MediaConnectorKind, MediaConnectorSummary>(
    (kind) =>
      api<MediaConnectorSummary>(`/media/connector-settings/${kind}/test`, {
        method: 'POST',
        body: {},
      }),
    ['media-connector-settings'],
  );
}

/** 回调地址里的密钥只在轮换这一次回传，之后再也拿不到。 */
export function useRotateMoviePilotWebhook() {
  return useSettingsMutation<{ sourceIp?: string }, MoviePilotWebhookResult>(
    (body) =>
      api<MoviePilotWebhookResult>('/media/connector-settings/moviepilot/webhook', {
        method: 'POST',
        body,
      }),
    ['media-connector-settings'],
  );
}

export function useRotatePlaybackWebhook() {
  return useSettingsMutation<
    { provider: MediaLibraryProviderKind; sourceIp?: string },
    PlaybackWebhookResult
  >(
    ({ provider, ...body }) =>
      api<PlaybackWebhookResult>(`/media/connector-settings/${provider}/playback-webhook`, {
        method: 'POST',
        body,
      }),
    ['media-connector-settings'],
  );
}

export interface SourceSettingsBody {
  isEnabled?: boolean;
  baseUrl?: string | null;
  credentialKind?: MediaCredentialKind | null;
  credential?: string;
  clearCredential?: boolean;
  imageBaseUrl?: string | null;
  userAgent?: string | null;
}

export function useSaveMediaSource() {
  return useSettingsMutation<
    { provider: MediaMetadataSource; body: SourceSettingsBody },
    MediaSourceConfig[]
  >(
    ({ provider, body }) =>
      api<MediaSourceConfig[]>(`/media/metadata-sources/${provider}`, { method: 'PUT', body }),
    ['media-metadata-sources', 'media-search'],
  );
}

export function useResetMediaSource() {
  return useSettingsMutation<MediaMetadataSource, MediaSourceConfig[]>(
    (provider) =>
      api<MediaSourceConfig[]>(`/media/metadata-sources/${provider}`, { method: 'DELETE' }),
    ['media-metadata-sources', 'media-search'],
  );
}

export function useMapPlaybackUser() {
  return useSettingsMutation<
    { provider: MediaLibraryProviderKind; externalUserId: string; memberId: string },
    { id: string }
  >(
    ({ provider, externalUserId, memberId }) =>
      api<{ id: string }>(
        `/media/playback-users/${provider}/${encodeURIComponent(externalUserId)}/mapping`,
        { method: 'PUT', body: { memberId } },
      ),
    ['media-playback-users'],
  );
}

export function useUnmapPlaybackUser() {
  return useSettingsMutation<string, { deleted: boolean }>(
    (mappingId) =>
      api<{ deleted: boolean }>(`/media/playback-user-mappings/${mappingId}`, { method: 'DELETE' }),
    ['media-playback-users'],
  );
}
