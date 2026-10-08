import type { RemindersFacade } from '@family/contracts';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { CreateReminderDto, RemindersService } from './reminders.module';

/** 提醒门面的实现（J4.1，接口见 contracts/plugins/reminders.facade.ts），RemindersModule 启动时注册。 */
export function remindersFacade(reminders: RemindersService): RemindersFacade {
  return {
    async previewSource(input, actor) {
      const { source, members } = await reminders.previewSource(input as CreateReminderDto, actor);
      return {
        source: { title: source.title, targetPath: source.targetPath },
        recipientNames: members.map((member) => member.name),
      };
    },
    createReminder: (transaction, input, actor) =>
      reminders.createWithinTransaction(input as CreateReminderDto, actor, fromPluginTransaction(transaction)),
  };
}
