// assistant 内核工具清单（J1b.5，docs/architecture.md §8.6 第 2 条、§9）：不属于任何插件的 agent 工具。
// 其余 agent 工具必须恰好被一个插件 manifest 的 queries / proposals 认领（check-plugins 断言，这里的也算进去）。
//
// sourceModule 是工具调用记录（agent_tool_events."sourceModule"）里写的值，数据库里的值，J1b 不改：
// get_today_summary / get_family_schedule 跨日历、任务、提醒，调用记录历来记在 calendar 名下
// （check-plugins 的 CORE_EXCEPTIONS 只放行这两行）；其余用内核自己的写法（keys.ts 的 KERNEL_ALIASES.agentSource）。

/** 不属于任何插件的 agent 工具名。 */
export const KERNEL_AGENT_TOOLS = [
  'get_today_summary', 'get_family_schedule', 'get_member_profile', 'get_weather',
  'propose_plan', 'recall_preferences', 'remember_preference',
] as const;
export type KernelAgentTool = (typeof KERNEL_AGENT_TOOLS)[number];

export interface CoreAssistantTool {
  label: string;
  sourceModule: string;
}

export const CORE_ASSISTANT_TOOLS: Readonly<Record<KernelAgentTool, CoreAssistantTool>> = {
  get_today_summary: { label: '今日摘要', sourceModule: 'calendar' },
  get_family_schedule: { label: '家庭日程', sourceModule: 'calendar' },
  get_member_profile: { label: '成员档案', sourceModule: 'member' },
  get_weather: { label: '天气', sourceModule: 'weather' },
  propose_plan: { label: '打包提案', sourceModule: 'agent_plan' },
  recall_preferences: { label: '读取记忆', sourceModule: 'agent_memory' },
  remember_preference: { label: '记住偏好', sourceModule: 'agent_memory' },
};

/** 内核工具调用记录的 sourceModule（agent-tools.service.ts 与插件工具的来源表合并后写进调用记录）。 */
export const CORE_TOOL_SOURCES = Object.fromEntries(KERNEL_AGENT_TOOLS.map((tool) => [tool, CORE_ASSISTANT_TOOLS[tool].sourceModule])) as Readonly<Record<KernelAgentTool, string>>;
