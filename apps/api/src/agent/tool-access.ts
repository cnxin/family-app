// 工具的第二、三层过滤（J4.2，docs/j4-agent-plan.md §3.3）：家庭把插件模块关掉 → 它的工具消失；
// 成员没有 manifest 里查询 / 动作声明的能力 → 工具消失。开会话时裁剪名单、执行时再核一遍，都用这里。
// 内核工具（core-assistant.ts）不归任何插件、没有能力要求，总是放行。
import { pluginToolRequirements } from '@family/contracts';
import type { DataSource } from 'typeorm';

export type ToolAccess = 'ok' | 'module_off' | 'no_capability';

export function toolAccess(
  tool: string,
  offModules: ReadonlySet<string>,
  can: (capability: string) => boolean,
): ToolAccess {
  const required = pluginToolRequirements()[tool];
  if (!required) return 'ok';
  if (offModules.has(required.plugin)) return 'module_off';
  return !required.capability || can(required.capability) ? 'ok' : 'no_capability';
}

/** 家庭显式关掉的模块（household_module_overrides 里 override = 'off' 的 key）。 */
export async function modulesTurnedOff(dataSource: DataSource, householdId: string) {
  const rows = await dataSource.query<{ key: string }[]>(
    `SELECT key FROM household_module_overrides WHERE household_id = $1 AND override = 'off'`,
    [householdId],
  );
  return new Set(rows.map((row) => row.key));
}
