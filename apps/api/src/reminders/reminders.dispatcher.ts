import { EventBus } from '../events/event-bus';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Notification, Reminder, ReminderRecipient } from '../entities';
import { resolveSource } from './reminders.helpers';

/** 到点发提醒：启动时开定时器，每隔一段时间扫一次到期提醒并发通知（J7.2 从 RemindersService 拆出）。 */
@Injectable()
export class ReminderDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(process.env.REMINDER_POLL_INTERVAL_MS || 15_000);
    const interval = Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 300_000))
      : 15_000;
    void this.dispatchDue();
    this.timer = setInterval(() => void this.dispatchDue(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    // 到点的提醒会生成站内通知：事务提交后给涉及的家庭推 reminders + notifications
    const touched = new Set<string>();
    try {
      await this.dataSource.transaction(async (manager) => {
        const reminders = manager.getRepository(Reminder);
        const recipients = manager.getRepository(ReminderRecipient);
        const notifications = manager.getRepository(Notification);
        const now = new Date();
        const due = await reminders
          .createQueryBuilder('reminder')
          .where('reminder.status = :status', { status: 'scheduled' })
          .andWhere('reminder.remindAt <= :now', { now })
          .orderBy('reminder.remindAt', 'ASC')
          .take(25)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        for (const reminder of due) {
          touched.add(reminder.householdId);
          const source = await resolveSource(manager, reminder, true);
          if (!source) {
            reminder.status = 'cancelled';
            reminder.cancelledAt = now;
            reminder.cancelReason = 'source_unavailable';
            await reminders.save(reminder);
            continue;
          }
          const pending = await recipients.find({
            where: { reminderId: reminder.id, deliveredAt: IsNull() },
            order: { createdAt: 'ASC' },
          });
          if (!pending.length) {
            reminder.status = 'sent';
            reminder.sentAt = now;
            await reminders.save(reminder);
            continue;
          }
          const delivered = await notifications.save(
            pending.map((recipient) =>
              notifications.create({
                householdId: reminder.householdId,
                recipientId: recipient.memberId,
                module: 'reminder',
                type: 'reminder_due',
                sourceId: reminder.id,
                title: `提醒：${source.title}`.slice(0, 160),
                body: source.summary?.slice(0, 500) || source.date,
                targetPath: source.targetPath,
              }),
            ),
          );
          await recipients.save(
            pending.map((recipient, index) => ({
              ...recipient,
              notificationId: delivered[index].id,
              deliveredAt: now,
            })),
          );
          reminder.status = 'sent';
          reminder.sentAt = now;
          await reminders.save(reminder);
        }
      });
      for (const householdId of touched) {
        this.events.publish({ householdId, domains: ['reminders', 'notifications'] });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'reminder_dispatch_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    } finally {
      this.dispatching = false;
    }
  }
}
