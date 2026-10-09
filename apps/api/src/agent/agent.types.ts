// 工具名单只此一份：J4.1 起由插件 manifest + core-assistant.ts 推导（packages/contracts/src/plugins/agent-tools.ts）。
export {
  AGENT_MEMORY_TOOLS,
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
  type AgentMemoryToolName,
  type AgentProposalToolName,
  type AgentReadToolName,
  type AgentToolName,
} from '@family/contracts';

import type { AgentRunStreamPayload } from '@family/contracts';

export const AGENT_HERMES_CHAT_TIMEOUT_MS = 6 * 60_000;
export const AGENT_HERMES_STOP_WAIT_MS = 45_000;
export const AGENT_TOOL_AUTHORIZATION_TTL_MS = 7 * 60_000;

export const AGENT_MEMORY_KEYS = [
  'diet_restriction',
  'spice_level',
  'cooking_skill',
  'schedule_preference',
  'reply_style',
  'other',
] as const;

export type AgentMemoryKey = (typeof AGENT_MEMORY_KEYS)[number];

export interface AgentChatInput {
  runId: string;
  modelAlias: string;
  message: string;
  allowedTools: string[];
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 不可信内容（页面上下文、检索结果、记忆……）：native 运行时加围栏后交给模型，不拼进成员原话。 */
  untrusted?: { label: string; content: string }[];
  /** J4.4 流式：native 运行时把循环的过程事件交出来（服务端补上 runId / seq 推到 /events）；其余运行时不调。 */
  onEvent?: (event: AgentRunStreamPayload) => void;
}

export interface AgentChatResult {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentRuntimeHealth {
  available: boolean;
  configured: boolean;
  version: string;
  message?: string;
}

export interface AgentRuntime {
  readonly kind: 'fake' | 'hermes' | 'native';
  readonly version: string;
  health(): Promise<AgentRuntimeHealth>;
  chat(input: AgentChatInput): Promise<AgentChatResult>;
  cancel(runId: string): Promise<void>;
}
