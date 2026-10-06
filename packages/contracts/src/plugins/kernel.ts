// J1b 内核机制的类型（docs/architecture.md §9）：插件之间不 import 对方的目录，只通过两种内核机制打交道——
//   - 门面（facade）：读与同步调用。接口在 plugins/<key>.facade.ts，实现在提供方插件目录，启动时注册到
//     apps/api 的 PluginFacadeRegistry；消费方从注册表按 key 取，manifest 声明 dependsOn。
//   - 事务内钩子（transaction hook）：同一事务里要连带写。发起方在事务里 run，订阅方用同一个事务写自己的表，
//     任一回调抛错整个事务回滚；manifest 声明 hooks。
// 这里只有类型与名字，没有实现（contracts 也给前端用，不能带 Nest / TypeORM）。

import type { CalendarFacade } from './calendar.facade';
import type { TasksFacade } from './tasks.facade';
import type { PluginRole } from './types';

/** 发起操作的成员。字段与 apps/api 的 JwtUser 一一对应，门面与钩子 payload 原样传递。 */
export interface PluginActor {
  sub: string;
  accountId: string;
  memberId: string;
  householdId: string;
  sid: string;
  name: string;
  role: PluginRole;
}

/**
 * 跨插件传递的事务句柄（apps/api 里就是 TypeORM 的 EntityManager）。contracts 不依赖 TypeORM，
 * 用一个不透明类型占位，由 apps/api 内核的 toPluginTransaction / fromPluginTransaction 转换。
 */
export interface PluginTransaction {
  readonly __pluginTransaction: 'EntityManager';
}

/** key → 门面接口。新增门面时在这里登记（check-plugins 断言接口只在 contracts 定义）。 */
export interface PluginFacades {
  tasks: TasksFacade;
  calendar: CalendarFacade;
}
export type PluginFacadeKey = keyof PluginFacades;

/** 钩子名 → payload。新增钩子时在这里与 TRANSACTION_HOOK_NAMES 一起登记。 */
export type TransactionHookPayloads = Record<never, never>;
export type TransactionHookName = keyof TransactionHookPayloads;

/** 运行时可校验的钩子名单（check-plugins、内核注册表都读它）。 */
export const TRANSACTION_HOOK_NAMES: readonly string[] = [];
