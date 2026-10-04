import { AGENT_MEMORY_TOOLS, type AgentMemoryToolName } from '@family/contracts';

// 工具名单只此一份，在 packages/contracts/src/agent.ts（J1.0）。
export {
  AGENT_MEMORY_TOOLS,
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
  type AgentMemoryToolName,
  type AgentProposalToolName,
  type AgentReadToolName,
  type AgentToolName,
} from '@family/contracts';

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

export function isAgentMemoryTool(value: string): value is AgentMemoryToolName {
  return AGENT_MEMORY_TOOLS.includes(value as AgentMemoryToolName);
}

export interface AgentChatInput {
  runId: string;
  modelAlias: string;
  message: string;
  allowedTools: string[];
  history: { role: 'user' | 'assistant'; content: string }[];
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
  readonly kind: 'fake' | 'hermes';
  readonly version: string;
  health(): Promise<AgentRuntimeHealth>;
  chat(input: AgentChatInput): Promise<AgentChatResult>;
  cancel(runId: string): Promise<void>;
}
