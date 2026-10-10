// J1b 内核机制的类型（docs/architecture.md §9）：插件之间不 import 对方的目录，只通过两种内核机制打交道——
//   - 门面（facade）：读与同步调用。接口在 plugins/<key>.facade.ts，实现在提供方插件目录，启动时注册到
//     apps/api 的 PluginFacadeRegistry；消费方从注册表按 key 取，manifest 声明 dependsOn。
//   - 事务内钩子（transaction hook）：同一事务里要连带写。发起方在事务里 run，订阅方用同一个事务写自己的表，
//     任一回调抛错整个事务回滚；manifest 声明 hooks。
// 这里只有类型与名字，没有实现（contracts 也给前端用，不能带 Nest / TypeORM）。

import type { AssetsFacade } from './assets.facade';
import type { CalendarFacade } from './calendar.facade';
import type { FinanceFacade } from './finance.facade';
import type { GuestsFacade } from './guests.facade';
import type { InventoryFacade } from './inventory.facade';
import type { KnowledgeFacade } from './knowledge.facade';
import type { LocationsFacade } from './locations.facade';
import type { MediaFacade } from './media.facade';
import type { MemoriesFacade } from './memories.facade';
import type { MenusFacade } from './menus.facade';
import type { PointsFacade } from './points.facade';
import type { PollsFacade } from './polls.facade';
import type { RecipesFacade } from './recipes.facade';
import type { RemindersFacade } from './reminders.facade';
import type { ShoppingFacade } from './shopping.facade';
import type { SmartHomeFacade } from './smart-home.facade';
import type { TravelFacade } from './travel.facade';
import type { SmartHomeLinkFiredPayload } from './smart-home.hooks';
import type { TasksFacade } from './tasks.facade';
import type { TaskCompletedEvent } from './tasks.events';
import type { TaskCompletedHookPayload, TaskUncompletedHookPayload } from './tasks.hooks';
import type { PluginKey } from './keys';
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
  locations: LocationsFacade;
  inventory: InventoryFacade;
  menus: MenusFacade;
  shopping: ShoppingFacade;
  assets: AssetsFacade;
  knowledge: KnowledgeFacade;
  travel: TravelFacade;
  media: MediaFacade;
  memories: MemoriesFacade;
  finance: FinanceFacade;
  polls: PollsFacade;
  reminders: RemindersFacade;
  recipes: RecipesFacade;
  points: PointsFacade;
  guests: GuestsFacade;
  'smart-home': SmartHomeFacade;
}
export type PluginFacadeKey = keyof PluginFacades;

/** 钩子名（<发起方 key>.<事件>）→ payload。新增钩子时在这里与 TRANSACTION_HOOK_NAMES 一起登记。 */
export interface TransactionHookPayloads {
  'tasks.completed': TaskCompletedHookPayload;
  'tasks.uncompleted': TaskUncompletedHookPayload;
  'smart-home.link-fired': SmartHomeLinkFiredPayload;
}
export type TransactionHookName = keyof TransactionHookPayloads;

/** 运行时可校验的钩子名单（check-plugins、内核注册表都读它）。 */
export const TRANSACTION_HOOK_NAMES: readonly TransactionHookName[] = [
  'tasks.completed',
  'tasks.uncompleted',
  'smart-home.link-fired',
];

/**
 * 同一钩子的订阅方之间有先后依赖时，在这里写死执行顺序；列出的按这里的顺序先跑，没列的按注册顺序排在后面。
 * 不写在这里就只能靠模块初始化顺序，换个 import 顺序就可能变。
 * - smart-home.link-fired：提醒挂在刚建的家务上（提醒校验会读家务那一行），家务必须先建；购物与二者无关，排最后
 *   （与搬家前「建家务 → 建提醒 → 加清单」的写入顺序一致）。
 */
export const TRANSACTION_HOOK_ORDER: { readonly [N in TransactionHookName]?: readonly PluginKey[] } = {
  'smart-home.link-fired': ['tasks', 'reminders', 'shopping'],
};

/**
 * 内核事件总线上的插件事件（事务提交后、进程内异步，发起方不等，订阅方出错只记日志）：事件名 → payload。
 * 和钩子不同：钩子在发起方的事务里同步跑、抛错回滚；事件只是「事情已经发生了」的通知。
 */
export interface PluginEventPayloads {
  'tasks.completed': TaskCompletedEvent;
}
export type PluginEventName = keyof PluginEventPayloads;
export const PLUGIN_EVENT_NAMES: readonly PluginEventName[] = ['tasks.completed'];
