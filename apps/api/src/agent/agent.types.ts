export const AGENT_READ_TOOLS = [
  'get_today_summary',
  'get_calendar',
  'get_inventory_alerts',
  'search_knowledge',
  'get_travel_checklist',
  'get_watch_candidates',
  'get_recent_memories',
] as const;

export type AgentReadToolName = (typeof AGENT_READ_TOOLS)[number];

export interface AgentChatInput {
  runId: string;
  modelAlias: string;
  message: string;
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
