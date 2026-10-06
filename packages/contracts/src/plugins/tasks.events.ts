// 任务插件在内核事件总线上发的事件（J1b）：事务提交后异步通知，发起方不等、订阅方出错只记日志。
// 订阅方：智能家居（家务打勾 → 联动规则，smart-home-links.service.ts）。
import type { PluginActor } from './kernel';

/** tasks.completed：某次家务被打勾完成（事务已提交）。 */
export interface TaskCompletedEvent {
  householdId: string;
  taskId: string;
  dueDate: string;
  title: string;
  actor: PluginActor;
}
