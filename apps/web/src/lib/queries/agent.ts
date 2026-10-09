import { invalidateModules } from './modules';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eventsConnected, listenAgentRuns, listenEventsConnected } from '@family/api-client';
import type {
  AgentActionProposal,
  AgentConversation,
  AgentConversationDetail,
  AgentRun,
  AgentRunStreamEvent,
  AgentStatus,
} from '@family/contracts';
import { api } from '../api';

function requestKey(scope: string) {
  return `${scope}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAgentStatus(enabled = true) {
  return useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api<AgentStatus>('/agent/status'),
    enabled,
    staleTime: 60_000,
  });
}

export function useAgentConversations() {
  return useQuery({
    queryKey: ['agent-conversations'],
    queryFn: () => api<AgentConversation[]>('/agent/conversations'),
  });
}

/** 外壳那条 /events 现在连没连着。 */
export function useEventsConnected() {
  return useSyncExternalStore(listenEventsConnected, eventsConnected, () => false);
}

/** /events 断着（重连中）、又有回答在跑时的兜底：每 2 秒取一次会话详情。连着就全靠推送。 */
export const AGENT_FALLBACK_POLL_MS = 2_000;

/**
 * 会话详情。后端排队 + worker 跑；每次工具调用和运行结束都推 assistant 域，对话页据此刷新；
 * 回答的过程走 useAgentRunStream。/events 断了才退回轮询。
 */
export function useAgentConversation(id: string | null) {
  const connected = useEventsConnected();
  return useQuery({
    queryKey: ['agent-conversation', id],
    queryFn: () => api<AgentConversationDetail>(`/agent/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      !connected && query.state.data?.runs.some((run) => run.status === 'queued' || run.status === 'running')
        ? AGENT_FALLBACK_POLL_MS
        : false,
  });
}

/** 一次 run 流式输出到哪了（J4.4）。 */
export interface AgentRunStream {
  conversationId: string;
  /** text_delta 按顺序拼起来的回答；落库后以会话详情里的回答为准。 */
  text: string;
  /** 调过的工具：toolCallId → 结果（还没回来是 null）。 */
  tools: { toolCallId: string; toolName: string; ok: boolean | null }[];
  done: boolean;
}

export function reduceAgentRunStream(current: AgentRunStream | undefined, event: AgentRunStreamEvent): AgentRunStream {
  const stream = current ?? { conversationId: event.conversationId, text: '', tools: [], done: false };
  switch (event.type) {
    case 'text_delta':
      return { ...stream, text: stream.text + event.text };
    case 'tool_call':
      return { ...stream, tools: [...stream.tools, { toolCallId: event.toolCallId, toolName: event.toolName, ok: null }] };
    case 'tool_result':
      return {
        ...stream,
        tools: stream.tools.map((tool) => (tool.toolCallId === event.toolCallId ? { ...tool, ok: event.ok } : tool)),
      };
    case 'done':
      return { ...stream, done: true };
    default:
      return stream;
  }
}

/**
 * 正在回答的 run 的流式状态，按 runId 存（J4.4）。text_delta 拼字、工具调用记进度；
 * 收到 proposal 和 done 让会话详情重取——提案卡的内容、落库后的回答都以库里为准。
 * fake / Hermes 不流式，只来一条 done，同样重取。
 */
export function useAgentRunStream(conversationId: string | null) {
  const client = useQueryClient();
  const [streams, setStreams] = useState<Record<string, AgentRunStream>>({});
  useEffect(() => {
    if (!conversationId) return;
    return listenAgentRuns((event) => {
      if (event.conversationId !== conversationId) return;
      setStreams((all) => ({ ...all, [event.runId]: reduceAgentRunStream(all[event.runId], event) }));
      if (event.type === 'proposal' || event.type === 'done') {
        void client.invalidateQueries({ queryKey: ['agent-conversation', conversationId] });
      }
      if (event.type === 'done') void client.invalidateQueries({ queryKey: ['agent-conversations'] });
    });
  }, [client, conversationId]);
  return streams;
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
