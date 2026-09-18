import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdjustmentBody,
  CreateRewardBody,
  PointsAccount,
  PointsLedger,
  Reward,
  RewardRedemption,
  UpdateRewardBody,
} from '@family/contracts';
import { api } from '../api';

/** 幂等键：客户端生成，服务端按 (household, key) 去重——重复点「确认」不会扣两次分。 */
export function idempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function invalidatePoints(client: ReturnType<typeof useQueryClient>) {
  for (const key of [
    'points-accounts',
    'points-ledger',
    'rewards',
    'reward-redemptions',
    'notifications',
  ]) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

export function usePointsAccounts() {
  return useQuery({
    queryKey: ['points-accounts'],
    queryFn: () => api<PointsAccount[]>('/points/accounts'),
  });
}

export function usePointsLedger() {
  return useQuery({
    queryKey: ['points-ledger'],
    queryFn: () => api<PointsLedger[]>('/points/ledger?limit=200'),
  });
}

/** 停用的奖励只有管理员看得到。 */
export function useRewards(includeInactive: boolean) {
  return useQuery({
    queryKey: ['rewards', includeInactive],
    queryFn: () => api<Reward[]>(`/rewards${includeInactive ? '?includeInactive=true' : ''}`),
  });
}

export function useRewardRedemptions() {
  return useQuery({
    queryKey: ['reward-redemptions'],
    queryFn: () => api<RewardRedemption[]>('/reward-redemptions'),
  });
}

export function useUpsertReward() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; body: CreateRewardBody | UpdateRewardBody }) =>
      input.id
        ? api<Reward>(`/rewards/${input.id}`, { method: 'PATCH', body: input.body })
        : api<Reward>('/rewards', { method: 'POST', body: input.body }),
    onSuccess: () => invalidatePoints(client),
  });
}

export function useAdjustPoints() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AdjustmentBody) =>
      api<PointsLedger>('/points/adjustments', { method: 'POST', body }),
    onSuccess: () => invalidatePoints(client),
  });
}

/** 反向冲销一条流水：原流水永久保留，另写一条相反方向的。 */
export function useReversePointsLedger() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; note?: string | null }) =>
      api<PointsLedger>(`/points/ledger/${input.id}/reverse`, {
        method: 'POST',
        body: { note: input.note ?? null, idempotencyKey: idempotencyKey() },
      }),
    onSuccess: () => invalidatePoints(client),
  });
}

/** 申请兑换：提交时就扣分，没通过会自动退回。 */
export function useRedeemReward() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { rewardId: string; note?: string | null }) =>
      api<RewardRedemption>(`/rewards/${input.rewardId}/redemptions`, {
        method: 'POST',
        body: { note: input.note ?? null, idempotencyKey: idempotencyKey() },
      }),
    onSuccess: () => invalidatePoints(client),
  });
}

export function useDecideRedemption() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject'; note?: string | null }) =>
      api<RewardRedemption>(`/reward-redemptions/${input.id}/decision`, {
        method: 'POST',
        body: { decision: input.decision, note: input.note ?? null, idempotencyKey: idempotencyKey() },
      }),
    onSuccess: () => invalidatePoints(client),
  });
}

export function useCancelRedemption() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; note?: string | null }) =>
      api<RewardRedemption>(`/reward-redemptions/${input.id}/cancel`, {
        method: 'POST',
        body: { note: input.note ?? null, idempotencyKey: idempotencyKey() },
      }),
    onSuccess: () => invalidatePoints(client),
  });
}

export function useReverseRedemption() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; note?: string | null }) =>
      api<RewardRedemption>(`/reward-redemptions/${input.id}/reverse`, {
        method: 'POST',
        body: { note: input.note ?? null, idempotencyKey: idempotencyKey() },
      }),
    onSuccess: () => invalidatePoints(client),
  });
}
