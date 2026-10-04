// J1.0：域 key 的唯一来源与别名表（docs/architecture.md §8.1、§8.6 第 1 条）。
//
// 一个插件一个 key，事件域、模块开关、⌘K 动作的 domain、manifest 都用它。历史上同一个域在别处
// 还有别的写法（动态流水 module、通知 module、导航分段 key、提案 actionType、agent 工具来源），
// 这些值已经写进数据库约束或线上数据，J1 不改值，只在这里登记「它属于哪个插件」。
// scripts/check-plugins.mjs 断言：各处的每个值都能在这里找到唯一归属，这里也没有死别名。

/** 18 个插件（§8.6 第 1 条）。顺序即文档顺序，没有运行时含义。 */
export const PLUGIN_KEYS = [
  'menus', 'recipes', 'shopping', 'inventory', 'locations', 'assets',
  'calendar', 'tasks', 'reminders', 'polls', 'finance', 'points',
  'guests', 'smart-home', 'media', 'travel', 'memories', 'knowledge',
] as const;
export type PluginKey = (typeof PLUGIN_KEYS)[number];

/** 内核与助理层的域：不是插件，但也推 /events、也可能出现在各处登记里。 */
export const KERNEL_DOMAIN_KEYS = [
  'notifications', 'activity', 'assistant', 'members', 'household', 'backups', 'modules',
] as const;
export type KernelDomainKey = (typeof KERNEL_DOMAIN_KEYS)[number];

/** 别名所在的 key 空间。 */
export type AliasSpace = 'nav' | 'activity' | 'notification' | 'proposal' | 'agentSource';

type AliasTable = Partial<Record<AliasSpace, readonly string[]>>;

/** 插件在别的 key 空间里的写法。没列的空间表示该插件在那里没有登记（或与插件 key 相同的导航 key 不用列）。 */
export const PLUGIN_ALIASES: Readonly<Record<PluginKey, AliasTable>> = {
  menus: { nav: ['order', 'kitchen'], activity: ['menu'], notification: ['menu'], proposal: ['menu'], agentSource: ['menu'] },
  recipes: { activity: ['recipe'], agentSource: ['recipe'] },
  shopping: { activity: ['shopping'], proposal: ['shopping'], agentSource: ['shopping'] },
  inventory: { activity: ['inventory'], agentSource: ['inventory'] },
  locations: { agentSource: ['locations'] },
  assets: { activity: ['asset'], agentSource: ['asset'] },
  calendar: { activity: ['calendar'], notification: ['calendar'], agentSource: ['calendar'] },
  tasks: { activity: ['task'], notification: ['task'], proposal: ['task'], agentSource: ['task'] },
  reminders: { activity: ['reminder'], notification: ['reminder'], proposal: ['reminder'], agentSource: ['reminder'] },
  polls: { activity: ['poll'], notification: ['poll'], proposal: ['poll'], agentSource: ['poll'] },
  finance: { activity: ['finance'], proposal: ['finance'], agentSource: ['finance'] },
  points: { activity: ['points'], notification: ['points'] },
  guests: { activity: ['guest'], notification: ['guest'] },
  'smart-home': {},
  media: { activity: ['media'], notification: ['media'], agentSource: ['media'] },
  travel: { activity: ['travel'], agentSource: ['travel'] },
  memories: { activity: ['memory'], agentSource: ['memory'] },
  knowledge: { activity: ['knowledge'], agentSource: ['knowledge'] },
};

/** 内核与助理层占用的别名。 */
export const KERNEL_ALIASES: Readonly<Record<AliasSpace, readonly string[]>> = {
  nav: ['today', 'notifications', 'members', 'backups', 'activity', 'assistant', 'profile'],
  activity: ['member', 'invitation', 'system'],
  notification: ['agent', 'system'],
  proposal: [],
  agentSource: ['weather', 'member', 'agent_memory', 'agent_plan', 'agent'],
};

/**
 * 不属于任何插件的 agent 工具（§8.6 第 2 条：J1b 起归 manifest 里的 assistant 内核清单）。
 * 其余工具必须恰好被一个插件 manifest 的 queries / actions 认领。
 */
export const KERNEL_AGENT_TOOLS = [
  'get_today_summary', 'get_family_schedule', 'get_member_profile', 'get_weather',
  'propose_plan', 'recall_preferences', 'remember_preference',
] as const;

/** 某个 key 空间里的值属于哪个插件；内核值返回 'kernel'，没登记返回 null。 */
export function aliasOwner(space: AliasSpace, value: string): PluginKey | 'kernel' | null {
  if (space === 'nav' && (PLUGIN_KEYS as readonly string[]).includes(value)) return value as PluginKey;
  for (const key of PLUGIN_KEYS) {
    if (PLUGIN_ALIASES[key][space]?.includes(value)) return key;
  }
  return KERNEL_ALIASES[space].includes(value) ? 'kernel' : null;
}
