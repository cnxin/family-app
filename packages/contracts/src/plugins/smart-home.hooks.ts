// 智能家居发起的事务内钩子（J1b）：一条联动触发、需要连带建东西时，在智能家居自己的事务里 run。
// 订阅方：任务（建家务）、提醒（建提醒）、购物（加清单项），各自用同一个事务建自己的；任一方抛错整条联动回滚。
// 执行顺序见 kernel.ts 的 TRANSACTION_HOOK_ORDER（提醒挂在刚建的家务上，家务必须先建）。
import type { PluginActor } from './kernel';

/** smart-home.link-fired：没带的部分就不建。 */
export interface SmartHomeLinkFiredPayload {
  householdId: string;
  /** 以家庭主人的名义、显示名「智能家居联动」 */
  actor: PluginActor;
  /** 要建的家务（一次性，从 startsOn 那天）。id 由智能家居预先生成：通知与提醒要挂在它上面 */
  task?: { id: string; title: string; startsOn: string; note?: string };
  /** 要建的提醒（挂在上面那件家务的那一天） */
  reminder?: {
    sourceModule: 'task';
    sourceId: string;
    occurrenceDate: string;
    remindAt: string;
    recipientIds: string[];
  };
  /** 要加进购物清单的手动项 */
  shoppingItem?: { date: string; customName: string; totalQty: number; unit: string };
}
