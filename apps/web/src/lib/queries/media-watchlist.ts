import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaExternalProvider,
  MediaLibraryMatch,
  MediaRequest,
  MediaSearchResponse,
  MediaType,
} from '@family/contracts';
import { api } from '../api';

export const MEDIA_STATUS_LABELS: Record<HouseholdMediaStatus, string> = {
  watchlist: '想看',
  voting: '投票中',
  scheduled: '已排期',
  watching: '在看',
  completed: '看完了',
  dropped: '不看了',
};

export const MEDIA_STATUS_STYLE: Record<HouseholdMediaStatus, string> = {
  watchlist: 'bg-accent-soft text-accent',
  voting: 'bg-warm-soft text-warm',
  scheduled: 'bg-warm-soft text-warm',
  watching: 'bg-accent-soft text-accent',
  completed: 'bg-muted text-ink-soft',
  dropped: 'bg-muted text-ink-soft',
};

/** 状态只能这么走，后端会拦非法流转（409），所以编辑表单里只画得通的那几个。 */
export const MEDIA_STATUS_TRANSITIONS: Record<HouseholdMediaStatus, HouseholdMediaStatus[]> = {
  watchlist: ['voting', 'scheduled', 'watching', 'completed', 'dropped'],
  voting: ['watchlist', 'scheduled', 'dropped'],
  scheduled: ['watchlist', 'watching', 'completed', 'dropped'],
  watching: ['completed', 'dropped', 'watchlist'],
  completed: ['watchlist', 'watching'],
  dropped: ['watchlist'],
};

export const MEDIA_REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: '等着处理',
  processing: '在处理了',
  completed: '订阅完成',
  failed: '订阅失败',
  cancelled: '已取消',
};

export function useMediaWatchlist(status: HouseholdMediaStatus | 'all', search: string) {
  const query = new URLSearchParams({ status });
  if (search.trim()) query.set('search', search.trim());
  const key = query.toString();
  return useQuery({
    queryKey: ['media', key],
    queryFn: () => api<HouseholdMedia[]>(`/media?${key}`),
  });
}

export function useMediaRequests() {
  return useQuery({
    queryKey: ['media-requests'],
    queryFn: () => api<MediaRequest[]>('/media/requests'),
  });
}

/**
 * 哪些条目在 Plex/Emby 里已经有了。后端会实时问一遍健康的连接器，再并上本地快照；
 * 单个连接器抖动会被静默吞掉，所以「播放按钮没了」不等于真的没入库。
 */
export function useMediaLibraryAvailability(mediaIds: string[]) {
  const ids = [...mediaIds].sort();
  return useQuery({
    queryKey: ['media-library-availability', ids.join(',')],
    queryFn: () =>
      api<Record<string, MediaLibraryMatch[]>>('/media/library-availability', {
        method: 'POST',
        body: { mediaIds: ids },
      }),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

/** 在线找片：豆瓣 / TMDB / Bangumi 三个源各查各的，谁没配就只是那一条显示未配置。 */
export function useMediaSearch(query: string, type: MediaType, enabled: boolean) {
  return useQuery({
    queryKey: ['media-search', type, query],
    queryFn: () =>
      api<MediaSearchResponse>(
        `/media/search?query=${encodeURIComponent(query)}&type=${type}`,
      ),
    enabled: enabled && query.trim().length > 0,
    staleTime: 5 * 60_000,
  });
}

function useWatchlistMutation<TInput, TResult>(
  run: (input: TInput) => Promise<TResult>,
  keys: string[],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => { void invalidateModules(client); },
    onSettled: () => {
      for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
    },
  });
}

export interface MediaEntryBody {
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  status: HouseholdMediaStatus;
  scheduledFor: string | null;
  note: string | null;
  externalRefs: { provider: MediaExternalProvider; externalId: string }[];
}

export function useCreateMedia() {
  return useWatchlistMutation<MediaEntryBody, HouseholdMedia>(
    (body) => api<HouseholdMedia>('/media', { method: 'POST', body }),
    ['media', 'calendar', 'activities'],
  );
}

/** 片单条目建好之后只能改这三样，其余是影视资料本身，属于另一条路。 */
export function useUpdateMedia() {
  return useWatchlistMutation<
    { id: string; status: HouseholdMediaStatus; scheduledFor: string | null; note: string | null },
    HouseholdMedia
  >(
    ({ id, ...body }) => api<HouseholdMedia>(`/media/${id}`, { method: 'PATCH', body }),
    ['media', 'calendar', 'activities'],
  );
}

export function useDeleteMedia() {
  return useWatchlistMutation<string, { id: string }>(
    (id) => api<{ id: string }>(`/media/${id}`, { method: 'DELETE' }),
    ['media', 'calendar', 'activities'],
  );
}

/** 只能补，不能改：同一个源已经有别的编号时后端 409。 */
export function useAddMediaExternalRefs() {
  return useWatchlistMutation<
    { id: string; externalRefs: { provider: MediaExternalProvider; externalId: string }[] },
    HouseholdMedia
  >(
    ({ id, externalRefs }) =>
      api<HouseholdMedia>(`/media/${id}/external-refs`, { method: 'POST', body: { externalRefs } }),
    ['media', 'media-library-availability', 'activities'],
  );
}

/** 让 MoviePilot 去找这部片。电影不传季数，剧集必须传。 */
export function useCreateMediaRequest() {
  return useWatchlistMutation<{ mediaId: string; season?: number }, MediaRequest>(
    ({ mediaId, season }) =>
      api<MediaRequest>(`/media/${mediaId}/requests`, {
        method: 'POST',
        body: { connectorKey: 'moviepilot', ...(season === undefined ? {} : { season }) },
      }),
    ['media-requests', 'activities'],
  );
}

export function useRefreshMediaRequest() {
  return useWatchlistMutation<string, MediaRequest>(
    (id) => api<MediaRequest>(`/media/requests/${id}/refresh`, { method: 'POST', body: {} }),
    ['media-requests', 'activities'],
  );
}

export function useCancelMediaRequest() {
  return useWatchlistMutation<string, MediaRequest>(
    (id) => api<MediaRequest>(`/media/requests/${id}`, { method: 'DELETE' }),
    ['media-requests', 'activities'],
  );
}
