export const AGENT_READ_TOOLS = [
  'get_today_summary',
  'get_calendar',
  'get_tasks',
  'get_shopping_list',
  'get_meal_plan',
  'get_inventory_alerts',
  'search_knowledge',
  'get_travel_checklist',
  'get_watch_candidates',
  'get_recent_memories',
  'get_member_tasks',
  'get_family_schedule',
  'get_inventory_summary',
  'search_recipes',
  'get_dish_plan',
  'get_weather',
  'get_member_profile',
] as const;

export type AgentReadToolName = (typeof AGENT_READ_TOOLS)[number];

export const AGENT_PROPOSAL_TOOLS = [
  'propose_task',
  'propose_reminder',
  'propose_poll',
  'propose_menu',
  'propose_shopping_items',
] as const;

export type AgentProposalToolName = (typeof AGENT_PROPOSAL_TOOLS)[number];

export const AGENT_MEMORY_TOOLS = [
  'recall_preferences',
  'remember_preference',
] as const;

export type AgentMemoryToolName = (typeof AGENT_MEMORY_TOOLS)[number];
export type AgentToolName =
  | AgentReadToolName
  | AgentProposalToolName
  | AgentMemoryToolName;

export const AGENT_HERMES_CHAT_TIMEOUT_MS = 3 * 60_000;
export const AGENT_TOOL_AUTHORIZATION_TTL_MS = 5 * 60_000;

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
