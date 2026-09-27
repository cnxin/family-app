import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppNotification } from '@family/contracts';
import { api } from '../api';

// ---- 站内通知 ---------------------------------------------------------------

/**
 * 通知是后台推过来的，页面开着的时候得自己去拿——30 秒一轮，
 * 和旧客户端一致。默认只看未读，勾了「全部」才带上已读。
 */
export function useNotifications(includeRead = false) {
  return useQuery({
    queryKey: ['notifications', includeRead],
    queryFn: () =>
      api<AppNotification[]>(`/notifications${includeRead ? '?includeRead=true' : ''}`),
    refetchInterval: 30_000,
  });
}

/** 导航角标复用未读列表，不另开计数接口。 */
export function useUnreadCount() {
  return useNotifications().data?.length ?? 0;
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AppNotification>(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
