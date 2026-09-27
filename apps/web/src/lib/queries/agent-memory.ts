import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentMemoryItem,
  AgentMemoryKey,
  AgentMemoryKind,
  AgentMemoryScope,
  AgentMemoryStatus,
  AgentProposalGroup,
} from '@family/contracts';
import { api } from '../api';

export function useAgentMemories(status: AgentMemoryStatus, scope: AgentMemoryScope) {
  return useQuery({
    queryKey: ['agent-memories', status, scope],
    queryFn: () => api<AgentMemoryItem[]>(`/agent/memories?status=${status}&scope=${scope}`),
  });
}

function invalidateMemories(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['agent-memories'] });
}

/** 自己主动记一条；进来是 candidate，要再确认一次才生效。 */
export function useCreateMemoryCandidate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { content: string; memoryKey: AgentMemoryKey; kind?: AgentMemoryKind }) =>
      api<AgentMemoryItem>('/agent/memories/candidates', { method: 'POST', body }),
    onSuccess: () => invalidateMemories(client),
  });
}

export function useConfirmAgentMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<AgentMemoryItem>(`/agent/memories/${input.id}/confirm`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateMemories(client),
  });
}

/** 共享之后是家庭范围可见，个人那份会被并掉。 */
export function useShareAgentMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<AgentMemoryItem>(`/agent/memories/${input.id}/share`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateMemories(client),
  });
}

export function useCorrectAgentMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      expectedVersion: number;
      content: string;
      memoryKey?: AgentMemoryKey;
    }) =>
      api<AgentMemoryItem>(`/agent/memories/${input.id}`, {
        method: 'PATCH',
        body: {
          expectedVersion: input.expectedVersion,
          content: input.content,
          ...(input.memoryKey ? { memoryKey: input.memoryKey, category: input.memoryKey } : {}),
        },
      }),
    onSuccess: () => invalidateMemories(client),
  });
}

/** 忘掉一条：DELETE 也要带 expectedVersion（乐观锁），少了会被判成版本冲突。 */
export function useForgetAgentMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<{ id: string; forgotten: true }>(`/agent/memories/${input.id}`, {
        method: 'DELETE',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateMemories(client),
  });
}

/** 清空本人记忆：密文被抹掉，只留审计事件。 */
export function useClearAgentMemories() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ forgottenCount: number }>('/agent/memories', { method: 'DELETE' }),
    onSuccess: () => invalidateMemories(client),
  });
}

// ---- 多步骤提案组 -------------------------------------------------------------

export function useAgentProposalGroups(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-proposal-groups'],
    queryFn: () => api<AgentProposalGroup[]>('/agent/proposal-groups'),
    enabled,
  });
}

function invalidateGroups(client: ReturnType<typeof useQueryClient>) {
  void invalidateModules(client);
  void client.invalidateQueries({ queryKey: ['agent-proposal-groups'] });
  void client.invalidateQueries({ queryKey: ['agent-conversation'] });
  void client.invalidateQueries({ queryKey: ['notifications'] });
}

/** 整组确认：后端按 stepOrder 顺序执行，中间失败会停住并标出来。 */
export function useConfirmAgentProposalGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<AgentProposalGroup>(`/agent/proposal-groups/${input.id}/confirm`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateGroups(client),
  });
}

export function useRejectAgentProposalGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<AgentProposalGroup>(`/agent/proposal-groups/${input.id}/reject`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: () => invalidateGroups(client),
  });
}
