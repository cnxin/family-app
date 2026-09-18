import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateNotificationChannelBody,
  NotificationChannel,
  NotificationDelivery,
  NotificationModule,
  UpdateNotificationChannelBody,
} from '@family/contracts';
import { api } from '../api';

export function useNotificationChannels() {
  return useQuery({
    queryKey: ['notification-channels'],
    queryFn: () => api<NotificationChannel[]>('/notification-channels'),
  });
}

function invalidateChannels(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['notification-channels'] });
  void client.invalidateQueries({ queryKey: ['notification-deliveries'] });
}

export function useUpsertNotificationChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      body: CreateNotificationChannelBody | UpdateNotificationChannelBody;
    }) =>
      input.id
        ? api<NotificationChannel>(`/notification-channels/${input.id}`, {
            method: 'PATCH',
            body: input.body,
          })
        : api<NotificationChannel>('/notification-channels', { method: 'POST', body: input.body }),
    onSuccess: () => invalidateChannels(client),
  });
}

export function useDeleteNotificationChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; deleted: boolean }>(`/notification-channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateChannels(client),
  });
}

/** 真的往外发一条测试消息；结果会记在渠道的 lastTestStatus 上。 */
export function useTestNotificationChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ success: true; testedAt: string }>(`/notification-channels/${id}/test`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateChannels(client),
  });
}

/** 「我在这个渠道收哪些模块」是每个成员自己的偏好，不是渠道本身的设置。 */
export function useUpdateChannelPreference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; isEnabled: boolean; modules: NotificationModule[] }) =>
      api<{ channelId: string; isEnabled: boolean; modules: NotificationModule[] }>(
        `/notification-channels/${input.id}/preference`,
        { method: 'PUT', body: { isEnabled: input.isEnabled, modules: input.modules } },
      ),
    onSuccess: () => invalidateChannels(client),
  });
}

export function useNotificationDeliveries(enabled: boolean) {
  return useQuery({
    queryKey: ['notification-deliveries'],
    queryFn: () => api<NotificationDelivery[]>('/notification-deliveries?status=all'),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useRetryNotificationDelivery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string }>(`/notification-deliveries/${id}/retry`, { method: 'POST' }),
    onSuccess: () => invalidateChannels(client),
  });
}
