import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TodayAttention } from '@family/contracts';
import { api } from '../api';

export const attentionKey = ['today', 'attention'] as const;
export function useAttention() {
  return useQuery({
    queryKey: attentionKey,
    queryFn: () => api<TodayAttention>('/today/attention'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
export function invalidateAttention(client: ReturnType<typeof useQueryClient>) {
  return client.invalidateQueries({ queryKey: attentionKey });
}
