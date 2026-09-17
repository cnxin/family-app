import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarEntry, CalendarEvent, CreateCalendarEventBody } from '@family/contracts';
import { api } from '../api';

// ---- 日历 -------------------------------------------------------------------

/** 一次拉一个月（六周网格的首尾两天为界），月份切换就是换 key。 */
export function useCalendarEntries(start: string, end: string) {
  return useQuery({
    queryKey: ['calendar', start, end],
    queryFn: () => api<CalendarEntry[]>(`/calendar?start=${start}&end=${end}`),
  });
}

export function useUpsertCalendarEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; body: CreateCalendarEventBody }) =>
      input.id
        ? api<CalendarEvent>(`/calendar-events/${input.id}`, {
            method: 'PATCH',
            body: input.body,
          })
        : api<CalendarEvent>('/calendar-events', { method: 'POST', body: input.body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useDeleteCalendarEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/calendar-events/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['calendar'] }),
  });
}
