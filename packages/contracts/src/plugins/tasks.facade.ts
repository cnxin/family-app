// 任务门面（J1b）：实现在 apps/api/src/tasks/tasks.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：日历（把任务排进日历视图）、智能家居（留意里查今天的「晾衣服」有没有打勾；联动查今天待做的家务、扫完打勾）、
// 小管家（查任务；任务提案确认后建任务）。
import type { CreateTaskBody, HouseholdTask, TaskOccurrence } from '../tasks';
import type { PluginActor, PluginTransaction } from './kernel';

/** 消费方实际用到的任务实例字段；实现返回的就是 GET /tasks 那一套对象（字段更多）。 */
export type TaskOccurrenceView = Pick<
  TaskOccurrence,
  'id' | 'taskId' | 'dueDate' | 'status' | 'assigneeId' | 'canManageTask' | 'canUpdate'
> & {
  assignee?: { name: string } | null;
  task: Pick<HouseholdTask, 'title' | 'note' | 'recurrence' | 'rewardPoints'> & {
    defaultAssignee?: { name: string } | null;
  };
};

export interface TasksFacade {
  /** 与 GET /tasks?start&end 同一个实现：一段日子里每件任务的每次发生（含已处理的历史），能不能管 / 改按 actor 算。 */
  listOccurrences(start: string, end: string, actor: PluginActor): Promise<TaskOccurrenceView[]>;
  /** 与 PATCH /tasks/:id/instances/:dueDate {status: 'done'} 同一个实现（自己的事务，连带记积分、发打勾事件）。 */
  completeOccurrence(taskId: string, dueDate: string, actor: PluginActor): Promise<void>;
  /** 与 POST /tasks 同一个实现，在调用方的事务里建（小管家任务提案确认）；返回任务 id。 */
  createTask(transaction: PluginTransaction, input: CreateTaskBody, actor: PluginActor): Promise<string>;
}
