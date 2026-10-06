// 任务插件发起的事务内钩子（J1b）：任务打勾 / 取消打勾时在任务自己的事务里 run，订阅方拿同一个事务连带写。
// 订阅方：积分（记 / 冲销任务积分）。任一订阅方抛错，任务状态的修改一起回滚。
import type { PluginActor } from './kernel';

/** tasks.completed：某天的任务实例从未完成变成已完成（已完成再打勾不触发）。 */
export interface TaskCompletedHookPayload {
  householdId: string;
  taskId: string;
  /** 刚保存的任务实例（同一事务里可重读） */
  instanceId: string;
  dueDate: string;
  title: string;
  rewardPoints: number;
  /** 记到谁头上：实例的负责人，没人认领时是打勾的人 */
  memberId: string;
  completedAt: Date;
  actor: PluginActor;
}

/** tasks.uncompleted：已完成的任务实例改回待办或跳过。 */
export interface TaskUncompletedHookPayload {
  householdId: string;
  taskId: string;
  instanceId: string;
  dueDate: string;
  title: string;
  rewardPoints: number;
  actor: PluginActor;
}
