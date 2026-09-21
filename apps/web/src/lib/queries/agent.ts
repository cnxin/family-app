import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgentActionProposal,
  AgentConversation,
  AgentConversationDetail,
  AgentRun,
  AgentStatus,
} from '@family/contracts';
import { api } from '../api';

function requestKey(scope: string) {
  return `${scope}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAgentStatus() {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api<AgentStatus>('/agent/status'),
    staleTime: 60_000,
  });
}

export function useAgentConversations() {
  return useQuery({
    queryKey: ['agent-conversations'],
    queryFn: () => api<AgentConversation[]>('/agent/conversations'),
  });
}

/**
 * 会话详情。后端是排队 + worker 跑，没有 SSE，所以有运行在队列里 / 跑着的时候按 700ms 轮询，
 * 跑完就停——这和旧客户端一致。
 */
export function useAgentConversation(id: string | null) {
  return useQuery({
    queryKey: ['agent-conversation', id],
    queryFn: () => api<AgentConversationDetail>(`/agent/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const detail = query.state.data as AgentConversationDetail | undefined;
      return detail?.runs.some((run) => run.status === 'queued' || run.status === 'running')
        ? 700
        : false;
    },
  });
}

export function useCreateAgentConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) =>
      api<AgentConversation>('/agent/conversations', {
        method: 'POST',
        body: title ? { title } : {},
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['agent-conversations'] }),
  });
}

export function useSendAgentMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; message: string }) =>
      api<AgentRun>(`/agent/conversations/${input.conversationId}/messages`, {
        method: 'POST',
        body: {
          message: input.message,
          clientRequestId: requestKey(`agent:message:${input.conversationId}`),
        },
      }),
    onSuccess: (_run, input) => {
      void client.invalidateQueries({ queryKey: ['agent-conversations'] });
      void client.invalidateQueries({ queryKey: ['agent-conversation', input.conversationId] });
    },
  });
}

export function useCancelAgentRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; conversationId: string }) =>
      api<AgentRun>(`/agent/runs/${input.runId}/cancel`, { method: 'POST' }),
    onSuccess: (_run, input) =>
      void client.invalidateQueries({ queryKey: ['agent-conversation', input.conversationId] }),
  });
}

/** 用原来的输入重跑一次；只有 detail 里的 runs[] 会把 retryable 算出来。 */
export function useRetryAgentRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { runId: string; conversationId: string }) =>
      api<AgentRun>(`/agent/runs/${input.runId}/retry`, {
        method: 'POST',
        body: { clientRequestId: requestKey(`agent:retry:${input.runId}`) },
      }),
    onSuccess: (_run, input) =>
      void client.invalidateQueries({ queryKey: ['agent-conversation', input.conversationId] }),
  });
}

export function useArchiveAgentConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; archived: true }>(`/agent/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['agent-conversations'] }),
  });
}

function invalidateProposal(client: ReturnType<typeof useQueryClient>, conversationId: string) {
  void invalidateModules(client);
  void client.invalidateQueries({ queryKey: ['agent-conversation', conversationId] });
  void client.invalidateQueries({ queryKey: ['notifications'] });
}

/** 确认提案会真的落库到对应业务域，所以带乐观锁 + 幂等键。 */
export function useConfirmAgentProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; conversationId: string; expectedVersion: number }) =>
      api<AgentActionProposal>(`/agent/proposals/${input.id}/confirm`, {
        method: 'POST',
        body: {
          expectedVersion: input.expectedVersion,
          clientRequestId: requestKey(`agent:confirm:${input.id}`),
        },
      }),
    onSuccess: (_proposal, input) => invalidateProposal(client, input.conversationId),
  });
}

export function useRejectAgentProposal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; conversationId: string; expectedVersion: number }) =>
      api<AgentActionProposal>(`/agent/proposals/${input.id}/reject`, {
        method: 'POST',
        body: { expectedVersion: input.expectedVersion },
      }),
    onSuccess: (_proposal, input) => invalidateProposal(client, input.conversationId),
  });
}
