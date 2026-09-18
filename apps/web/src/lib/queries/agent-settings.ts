import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentChannelPairing,
  AgentMemberChannel,
  AgentRuntimeKind,
  AgentSettings,
} from '@family/contracts';
import { api } from '../api';

export function useUpdateAgentSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      expectedVersion: number;
      enabled?: boolean;
      runtimeKind?: AgentRuntimeKind;
    }) => api<AgentSettings>('/agent/settings', { method: 'PATCH', body }),
    onSuccess: (settings) => {
      client.setQueryData(['agent-settings'], settings);
      void client.invalidateQueries({ queryKey: ['agent-status'] });
    },
  });
}

export function useAgentChannels() {
  return useQuery({
    queryKey: ['agent-channels'],
    queryFn: () => api<AgentMemberChannel[]>('/agent/channels'),
  });
}

export function useAgentChannelPairings(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-channel-pairings'],
    queryFn: () => api<AgentChannelPairing[]>('/agent/channel-pairings'),
    enabled,
  });
}

function invalidateChannels(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['agent-channels'] });
  void client.invalidateQueries({ queryKey: ['agent-channel-pairings'] });
}

/** 配对码是幂等签发的：同一个 idempotencyKey 再来一次不会给新码，明文只在第一次出现。 */
export function useCreateAgentChannelPairing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; platform: string }) =>
      api<{ pairingCode: string | null; replayed: boolean }>('/agent/channel-pairings', {
        method: 'POST',
        body: {
          memberId: input.memberId,
          platform: input.platform,
          idempotencyKey: `web:pairing:${input.memberId}:${input.platform}:${Date.now()}`,
        },
      }),
    onSuccess: () => invalidateChannels(client),
  });
}

export function useRevokeAgentChannel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<AgentMemberChannel>(`/agent/channels/${input.id}/revoke`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateChannels(client),
  });
}

export function useRevokeAgentChannelPairing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AgentChannelPairing>(`/agent/channel-pairings/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => invalidateChannels(client),
  });
}
