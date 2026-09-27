import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HouseholdMedia,
  MediaConnectorSummary,
  MediaLibraryResponse,
  MediaLibrarySyncResponse,
  MediaType,
  ViewingSession,
} from '@family/contracts';
import { api } from '../api';

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  movie: '电影',
  series: '剧集',
};

export const MEDIA_CONNECTOR_STATE_LABELS: Record<string, string> = {
  online: '已连接',
  not_configured: '没配',
  needs_credential: '等授权',
  disabled: '停用了',
  offline: '连不上',
};

/**
 * 海报和播放地址可能是连接器给的绝对 URL，也可能是后端签的相对路径
 * （`/media/library/<id>/poster?expires=&signature=`，24 小时有效、公开端点）。
 * 相对的要补上 `/api` 前缀走代理，绝对的原样用。
 */
export function mediaAsset(url: string | null) {
  if (!url) return null;
  return url.startsWith('http') ? url : `/api${url}`;
}

export function useMediaEntries() {
  return useQuery({
    queryKey: ['media', 'all'],
    queryFn: () => api<HouseholdMedia[]>('/media?status=all'),
  });
}

export function useMediaConnectors() {
  return useQuery({
    queryKey: ['media-connectors'],
    queryFn: () => api<MediaConnectorSummary[]>('/media/connectors'),
    staleTime: 30_000,
  });
}

export function useViewingSessions() {
  return useQuery({
    queryKey: ['viewing-sessions'],
    queryFn: () => api<ViewingSession[]>('/media/viewing-sessions'),
  });
}

export function useMediaLibrary(input: { type: MediaType | 'all'; search: string; page: number }) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: '24' });
  if (input.type !== 'all') query.set('type', input.type);
  if (input.search.trim()) query.set('search', input.search.trim());
  const search = query.toString();
  return useQuery({
    queryKey: ['media-library', search],
    queryFn: () => api<MediaLibraryResponse>(`/media/library?${search}`),
    // 翻页时保留上一页，别整页闪回骨架
    placeholderData: (previous) => previous,
  });
}

function useMediaMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateModules(client);
      for (const key of ['media-library', 'media', 'media-connectors', 'activities']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** 同步要 manage_integrations（只有管理员有）；没配连接器时后端 502，消息是中文的。 */
export function useSyncMediaLibrary() {
  return useMediaMutation<void, MediaLibrarySyncResponse>(() =>
    api<MediaLibrarySyncResponse>('/media/library/sync', { method: 'POST', body: {} }),
  );
}

/** 加片单人人都能做。重复加会回 added:false，所以文案要说清楚「已经在片单里」。 */
export function useAddLibraryItemToWatchlist() {
  return useMediaMutation<string, { householdMediaId: string; added: boolean }>((id) =>
    api<{ householdMediaId: string; added: boolean }>(`/media/library/${id}/add`, {
      method: 'POST',
      body: {},
    }),
  );
}
