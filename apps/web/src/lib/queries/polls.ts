import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePollBody, HouseholdPoll, UpdatePollBody } from '@family/contracts';
import { api } from '../api';

/** 一次拿全部（含已结束），筛选在客户端做；列表不大，省得切筛选就打一次网络。 */
export function usePolls() {
  return useQuery({
    queryKey: ['polls'],
    queryFn: () => api<HouseholdPoll[]>('/polls?status=all'),
  });
}

function invalidatePollSideEffects(client: ReturnType<typeof useQueryClient>) {
  // 投票会出现在日历、提醒来源和站内通知里，旧客户端也是这几个一起刷
  for (const key of ['polls', 'notifications', 'reminder-sources', 'reminders', 'calendar']) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

export function useUpsertPoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; body: CreatePollBody | UpdatePollBody }) =>
      input.id
        ? api<HouseholdPoll>(`/polls/${input.id}`, { method: 'PATCH', body: input.body })
        : api<HouseholdPoll>('/polls', { method: 'POST', body: input.body }),
    onSuccess: () => invalidatePollSideEffects(client),
  });
}

/** 投票、改票、撤票（空数组）走同一个端点。 */
export function useVotePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; optionIds: string[] }) =>
      api<HouseholdPoll>(`/polls/${input.id}/votes`, {
        method: 'POST',
        body: { optionIds: input.optionIds },
      }),
    onSuccess: (poll) => {
      client.setQueryData<HouseholdPoll[]>(['polls'], (current) =>
        current?.map((one) => (one.id === poll.id ? poll : one)),
      );
    },
  });
}

export function useSetPollStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; action: 'close' | 'reopen' }) =>
      api<HouseholdPoll>(`/polls/${input.id}/${input.action}`, { method: 'POST' }),
    onSuccess: () => invalidatePollSideEffects(client),
  });
}

export function useArchivePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ archived: true }>(`/polls/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePollSideEffects(client),
  });
}
