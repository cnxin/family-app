// 插件注册表（J1）。各处登记从这里取已迁移插件的条目；还没迁的域仍在原处手写。
// 迁一个域 = 在本目录加一份 <key>.ts manifest、放进 PLUGINS、删掉各处对应的手写条目，
// 再让 scripts/check-plugins.mjs 与 apps/web 的 plugins-registry 单测确认两边一致。
import type {
  PluginAction,
  PluginAttention,
  PluginManifest,
  PluginNavSegment,
  PluginUsageTable,
} from './types';
import { PLUGIN_ALIASES, PLUGIN_KEYS, type PluginKey } from './keys';
import { knowledgeManifest } from './knowledge';
import { memoriesManifest } from './memories';
import { pollsManifest } from './polls';
import { recipesManifest } from './recipes';
import { travelManifest } from './travel';

export * from './keys';
export * from './types';

/** 已迁移的插件。顺序没有运行时含义，各登记处的顺序仍由各自决定。 */
export const PLUGINS: readonly PluginManifest[] = [knowledgeManifest, memoriesManifest, travelManifest, pollsManifest, recipesManifest];

export function findPlugin(key: string): PluginManifest | undefined {
  return PLUGINS.find((plugin) => plugin.key === key);
}

function requirePlugin(key: PluginKey): PluginManifest {
  const plugin = findPlugin(key);
  if (!plugin) throw new Error(`插件 ${key} 还没迁到 manifest，不能从注册表取`);
  return plugin;
}

export function isPluginKey(value: string): value is PluginKey {
  return (PLUGIN_KEYS as readonly string[]).includes(value);
}

// ---- 导航、⌘K、旧路径：按 key 取，放回各登记处原来的位置，保持现有顺序 ---------------------------------

export function pluginNav(key: PluginKey): readonly (PluginNavSegment & { tier: NonNullable<PluginNavSegment['tier']> })[] {
  const plugin = requirePlugin(key);
  return plugin.nav.map((segment) => ({ ...segment, tier: segment.tier ?? plugin.tier }));
}

export function pluginActions(key: PluginKey): readonly PluginAction[] {
  return requirePlugin(key).actions ?? [];
}

export function pluginLegacyPaths(key: PluginKey): readonly (readonly [string, string])[] {
  return requirePlugin(key).legacyPaths ?? [];
}

// ---- 事件 -------------------------------------------------------------------------------------

export interface GeneratedEventRoute {
  prefix: string;
  domains: readonly string[];
  emit?: 'explicit';
}

export function pluginEventRoutes(): readonly GeneratedEventRoute[] {
  return PLUGINS.flatMap((plugin) =>
    plugin.events.routes.map((route) => ({
      prefix: route.prefix,
      domains: route.domains ?? [plugin.key],
      ...(route.emit ? { emit: route.emit } : {}),
    })),
  );
}

export function pluginEventExempt(): readonly { prefix: string; reason: string }[] {
  return PLUGINS.flatMap((plugin) => plugin.events.exempt ?? []);
}

export function pluginQueryKeys(): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(PLUGINS.map((plugin) => [plugin.key, plugin.events.queryKeys]));
}

// ---- 模块开关 -----------------------------------------------------------------------------------

/** hasData 为 tables 时生成的存在性 SQL（$1 = 家庭 ID）；always / server 返回 null，由内核或插件服务端处理。 */
export function pluginHasDataSql(key: string): string | null {
  const plugin = findPlugin(key);
  const hasData = plugin?.module.hasData;
  if (!hasData || hasData.kind !== 'tables') return null;
  return hasData.tables
    .map(({ table, where }) => `SELECT 1 FROM ${table} WHERE "householdId" = $1${where ? ` AND ${where}` : ''}`)
    .join('\n    UNION ALL ');
}

// ---- 留意 -------------------------------------------------------------------------------------

export function pluginAttention(): readonly { key: string; attention: PluginAttention }[] {
  return PLUGINS.flatMap((plugin) => (plugin.attention ? [{ key: plugin.key, attention: plugin.attention }] : []));
}

/** 把 `{name}` 这类占位换成值；没给的占位换成空串。 */
export function renderTemplate(template: string, values: Readonly<Record<string, string | number | undefined>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

// ---- agent 工具、通知、能力 ------------------------------------------------------------------------

/** 工具名 → 认领它的插件（只含已迁移插件）。 */
export function pluginToolOwners(): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const plugin of PLUGINS) {
    for (const query of plugin.queries ?? []) if (query.legacyTool) owners.set(query.legacyTool, plugin.key);
    for (const action of plugin.actions ?? []) if (action.propose?.legacyTool) owners.set(action.propose.legacyTool, plugin.key);
  }
  return owners;
}

/** agent 工具调用记录的 sourceModule：插件认领的工具取它 agentSource 别名的第一个。 */
export function pluginToolSources(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...pluginToolOwners()].flatMap(([tool, key]) => {
      const source = PLUGIN_ALIASES[key as PluginKey].agentSource?.[0];
      return source ? [[tool, source]] : [];
    }),
  );
}

/** 已迁插件的写提案：工具名、actionType、提案卡类型名、能否打包进 propose_plan。 */
export function pluginProposals(): readonly { plugin: string; tool: string; actionType: string; label: string; grouped: boolean }[] {
  return PLUGINS.flatMap((plugin) =>
    (plugin.actions ?? []).flatMap((action) =>
      action.propose?.legacyTool
        ? [{
            plugin: plugin.key,
            tool: action.propose.legacyTool,
            actionType: action.propose.actionType,
            label: action.propose.label,
            grouped: action.propose.grouped ?? true,
          }]
        : [],
    ),
  );
}

export function pluginNotificationModules(): readonly { key: string; label: string; icon: string }[] {
  return PLUGINS.flatMap((plugin) => plugin.notifications ?? []);
}

export function pluginCapabilities(): readonly { key: string; roles: readonly string[] }[] {
  return PLUGINS.flatMap((plugin) => plugin.capabilities ?? []);
}

// ---- 用量统计（apps/api/scripts/usage-report.mjs） ----------------------------------------------------

export interface GeneratedUsageTable {
  domain: string;
  source: string;
  sql: string;
}

function usageSql(table: PluginUsageTable) {
  const member = table.memberColumn ? `"${table.memberColumn}"` : 'NULL::uuid';
  const now = table.createdTz === false ? 'LOCALTIMESTAMP' : 'now()';
  const where = table.where ? `${table.where} AND ` : '';
  return `SELECT "householdId" AS household, ${member} AS member FROM ${table.table} WHERE ${where}"${table.createdColumn}" >= ${now} - make_interval(days => $1)`;
}

export function pluginUsage(): {
  activityDomains: Readonly<Record<string, string>>;
  tables: readonly GeneratedUsageTable[];
  uncounted: readonly string[];
} {
  const activityDomains: Record<string, string> = {};
  const tables: GeneratedUsageTable[] = [];
  const uncounted: string[] = [];
  for (const plugin of PLUGINS) {
    const usage = plugin.usage;
    if (!usage) continue;
    for (const module of usage.activityModules ?? []) activityDomains[module] = usage.label;
    for (const table of usage.tables ?? []) {
      tables.push({
        domain: table.label,
        source: `主表新增 ${table.table}${table.note ? `（${table.note}）` : ''}`,
        sql: usageSql(table),
      });
    }
    uncounted.push(...(usage.uncounted ?? []));
  }
  return { activityDomains, tables, uncounted };
}
