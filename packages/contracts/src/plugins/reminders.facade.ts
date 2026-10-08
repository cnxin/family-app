// 提醒门面（J4.1）：实现在 apps/api/src/reminders/reminders.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（提醒提案的预览与确认后建提醒）。
import type { CreateReminderBody } from '../reminders';
import type { PluginActor, PluginTransaction } from './kernel';

/** 提醒挂在哪件事上、发给谁（预览用）。 */
export interface ReminderPreview {
  source: { title: string; targetPath: string };
  recipientNames: string[];
}

export interface RemindersFacade {
  /** 关联事项不存在或已结束抛 404「关联事项不存在或已经结束」，接收人不在本家庭抛 404。不写库。 */
  previewSource(input: CreateReminderBody, actor: PluginActor): Promise<ReminderPreview>;
  /** 与 POST /reminders 同一个实现，在调用方的事务里建；返回提醒 id。 */
  createReminder(transaction: PluginTransaction, input: CreateReminderBody, actor: PluginActor): Promise<string>;
}
