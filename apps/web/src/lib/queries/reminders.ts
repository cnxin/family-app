import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateReminderBody,
  HouseholdReminder,
  ReminderSource,
  ReminderStatus,
} from '@family/contracts';
import { api } from '../api';

// ---- 提醒 -------------------------------------------------------------------

/**
 * 提醒是有时效的：到点了后台会发出去，状态从 scheduled 变 sent。
 * 所以待发的列表要轮询，否则页面上会一直挂着一条其实已经发了的。
 */
export function useReminders(status: ReminderStatus | 'all' = 'all') {
  return useQuery({
    queryKey: ['reminders', status],
    queryFn: () => api<HouseholdReminder[]>(`/reminders?status=${status}`),
    refetchInterval: status === 'scheduled' || status === 'all' ? 15_000 : false,
  });
}

/** 可被提醒的事项：日历条目 + 开放投票 + 启用的维护计划，一次拉一年。 */
export function useReminderSources(start: string, end: string) {
  return useQuery({
    queryKey: ['reminder-sources', start, end],
    queryFn: () => api<ReminderSource[]>(`/reminder-sources?start=${start}&end=${end}`),
    staleTime: 60_000,
  });
}

export function useUpsertReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CreateReminderBody & { id?: string }) =>
      id
        ? api<HouseholdReminder>(`/reminders/${id}`, {
            method: 'PATCH',
            // 改的时候只能动时间和接收人，来源是定死的
            body: { remindAt: body.remindAt, recipientIds: body.recipientIds },
          })
        : api<HouseholdReminder>('/reminders', { method: 'POST', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['reminders'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useCancelReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<HouseholdReminder>(`/reminders/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
