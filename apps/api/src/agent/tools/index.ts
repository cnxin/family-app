// 小管家的 30 个工具（J4.1）：读工具由插件 manifest 的 queries 生成名字、提案工具由 actions(propose) 生成，
// 加 core-assistant.ts 的 7 个内核工具；名单与 manifest 推导一致由 check-plugins 与 agent-tools.check.ts 盯着。
// MCP（Hermes）与以后的自研循环用同一个注册表。
import { agentToolAliases } from '@family/contracts';
import { ToolRegistry } from '@family/agent-core';
import { getAssetDetailTool } from './assets';
import { getCalendarTool } from './calendar';
import type { AgentToolContext, AgentToolDeps } from './context';
import { getFinanceSummaryTool, proposeFinanceTransactionTool } from './finance';
import { getInventoryAlertsTool, getInventorySummaryTool } from './inventory';
import {
  getFamilyScheduleTool,
  getMemberProfileTool,
  getTodaySummaryTool,
  getWeatherTool,
  proposePlanTool,
  recallPreferencesTool,
  rememberPreferenceTool,
} from './kernel';
import { searchKnowledgeTool } from './knowledge';
import { findItemTool, listLocationContentsTool } from './locations';
import { getWatchCandidatesTool } from './media';
import { getRecentMemoriesTool } from './memories';
import { getDishPlanTool, getMealPlanTool, proposeMenuTool } from './menus';
import { proposePollTool } from './polls';
import { searchRecipesTool } from './recipes';
import { proposeReminderTool } from './reminders';
import { getShoppingListTool, proposeShoppingItemsTool } from './shopping';
import { getMemberTasksTool, getTasksTool, proposeTaskTool } from './tasks';
import { getTravelChecklistTool } from './travel';

export type { AgentToolContext, AgentToolDeps } from './context';

/** 注册顺序就是 MCP tools/list 的顺序（历史顺序；改了 tools/list 快照就对不上）。 */
export function createAgentToolRegistry(deps: AgentToolDeps): ToolRegistry<AgentToolContext> {
  const proposeTools = [
    proposeTaskTool(deps),
    proposeReminderTool(deps),
    proposePollTool(deps),
    proposeMenuTool(deps),
    proposeShoppingItemsTool(deps),
    proposeFinanceTransactionTool(deps),
  ];
  const tools = [
    getTodaySummaryTool(deps),
    getCalendarTool(deps),
    getTasksTool(deps),
    getShoppingListTool(deps),
    getMealPlanTool(deps),
    getInventoryAlertsTool(deps),
    searchKnowledgeTool(deps),
    getTravelChecklistTool(deps),
    getWatchCandidatesTool(deps),
    getRecentMemoriesTool(deps),
    getMemberTasksTool(deps),
    getFamilyScheduleTool(deps),
    getInventorySummaryTool(deps),
    searchRecipesTool(deps),
    getDishPlanTool(deps),
    getWeatherTool(),
    getMemberProfileTool(deps),
    getAssetDetailTool(deps),
    getFinanceSummaryTool(deps),
    findItemTool(deps),
    listLocationContentsTool(deps),
    recallPreferencesTool(deps),
    rememberPreferenceTool(deps),
    proposePlanTool(deps, proposeTools),
    ...proposeTools,
  ];
  const aliases = agentToolAliases();
  const registry = new ToolRegistry<AgentToolContext>();
  for (const tool of tools) registry.register({ ...tool, aliases: aliases[tool.name] ?? [] });
  return registry;
}
