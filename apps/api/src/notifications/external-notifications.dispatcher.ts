import { EventBus } from '../events/event-bus';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Brackets, DataSource, In } from 'typeorm';
import {
  MemberNotificationPreference,
  Notification,
  NotificationDelivery,
  NotificationDeliveryAttempt,
} from '../entities';
import { AUTO_ATTEMPTS } from './external-notifications.helpers';
import {
  SendResult,
  sendToChannel,
  configurationFailure,
  retryBaseMs,
} from './external-notifications.send';

/** 外部通知派发：启动时开定时器，把站内通知路由到各渠道、认领投递、发送、按退避重试，并恢复中断的投递（J7.2 从 ExternalNotificationsService 拆出）。 */
@Injectable()
export class ExternalNotificationsDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(
      process.env.NOTIFICATION_DELIVERY_POLL_INTERVAL_MS || 10_000,
    );
    const interval = Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 300_000))
      : 10_000;
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async routeNotifications() {
    await this.dataSource.transaction(async (manager) => {
      const notifications = await manager
        .getRepository(Notification)
        .createQueryBuilder('notification')
        .where('notification.externalRoutedAt IS NULL')
        .orderBy('notification.createdAt', 'ASC')
        .take(50)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (!notifications.length) return;

      const recipientIds = [
        ...new Set(notifications.map((notification) => notification.recipientId)),
      ];
      const preferences = await manager
        .getRepository(MemberNotificationPreference)
        .createQueryBuilder('preference')
        .innerJoinAndSelect(
          'preference.channel',
          'channel',
          'channel.isEnabled = true',
        )
        .where('preference.memberId IN (:...recipientIds)', { recipientIds })
        .andWhere('preference.isEnabled = true')
        .getMany();
      const byRecipient = new Map<string, MemberNotificationPreference[]>();
      for (const preference of preferences) {
        const list = byRecipient.get(preference.memberId) ?? [];
        list.push(preference);
        byRecipient.set(preference.memberId, list);
      }
      const deliveries = notifications.flatMap((notification) =>
        (byRecipient.get(notification.recipientId) ?? [])
          .filter(
            (preference) =>
              preference.householdId === notification.householdId &&
              preference.channel.householdId === notification.householdId &&
              preference.modules.includes(notification.module),
          )
          .map((preference) =>
            manager.getRepository(NotificationDelivery).create({
              householdId: notification.householdId,
              notificationId: notification.id,
              recipientId: notification.recipientId,
              channelId: preference.channelId,
              channelName: preference.channel.name,
              channelKind: preference.channel.kind,
              endpointHint: preference.channel.endpointHint,
              status: 'pending',
              attemptCount: 0,
              maxAttempts: AUTO_ATTEMPTS,
              nextAttemptAt: new Date(),
              lastAttemptAt: null,
              deliveredAt: null,
              lastError: null,
            }),
          ),
      );
      if (deliveries.length) {
        await manager
          .getRepository(NotificationDelivery)
          .createQueryBuilder()
          .insert()
          .values(deliveries)
          .orIgnore()
          .execute();
      }
      await manager.getRepository(Notification).update(
        { id: In(notifications.map((notification) => notification.id)) },
        { externalRoutedAt: new Date() },
      );
    });
  }

  private async recoverInterruptedDeliveries() {
    const staleAt = new Date(Date.now() - 120_000);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationDelivery);
      const stale = await repository
        .createQueryBuilder('delivery')
        .where('delivery.status = :status', { status: 'processing' })
        .andWhere('delivery.lastAttemptAt <= :staleAt', { staleAt })
        .orderBy('delivery.lastAttemptAt', 'ASC')
        .take(25)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      for (const delivery of stale) {
        await manager
          .getRepository(NotificationDeliveryAttempt)
          .createQueryBuilder()
          .insert()
          .values({
            deliveryId: delivery.id,
            attemptNumber: delivery.attemptCount,
            status: 'failed',
            httpStatus: null,
            errorCode: 'WORKER_INTERRUPTED',
            errorMessage: '投递进程中断，已安排重试',
            startedAt: delivery.lastAttemptAt ?? staleAt,
            finishedAt: new Date(),
          })
          .orIgnore()
          .execute();
        delivery.status = 'retry_scheduled';
        delivery.nextAttemptAt = new Date();
        delivery.lastError = '投递进程中断，已安排重试';
        await repository.save(delivery);
      }
    });
  }

  private async claimDelivery() {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationDelivery);
      const delivery = await repository
        .createQueryBuilder('delivery')
        .leftJoinAndSelect('delivery.notification', 'notification')
        .leftJoinAndSelect('delivery.recipient', 'recipient')
        .leftJoinAndSelect('delivery.channel', 'channel')
        .addSelect('channel.endpointEncrypted')
        .addSelect('channel.credentialEncrypted')
        .where('delivery.status IN (:...statuses)', {
          statuses: ['pending', 'retry_scheduled'],
        })
        .andWhere(
          new Brackets((query) =>
            query
              .where('delivery.nextAttemptAt IS NULL')
              .orWhere('delivery.nextAttemptAt <= :now', { now: new Date() }),
          ),
        )
        .orderBy('delivery.nextAttemptAt', 'ASC', 'NULLS FIRST')
        .addOrderBy('delivery.createdAt', 'ASC')
        .take(1)
        .setLock('pessimistic_write', undefined, ['delivery'])
        .setOnLocked('skip_locked')
        .getOne();
      if (!delivery) return null;
      delivery.status = 'processing';
      delivery.attemptCount += 1;
      delivery.lastAttemptAt = new Date();
      delivery.nextAttemptAt = null;
      await repository.save(delivery);
      return delivery;
    });
  }

  private async finalizeDelivery(
    claimed: NotificationDelivery,
    result: SendResult,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationDelivery);
      const delivery = await repository
        .createQueryBuilder('delivery')
        .where('delivery.id = :id', { id: claimed.id })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !delivery ||
        delivery.status !== 'processing' ||
        delivery.attemptCount !== claimed.attemptCount
      ) {
        return;
      }
      await manager.getRepository(NotificationDeliveryAttempt).save({
        deliveryId: delivery.id,
        attemptNumber: delivery.attemptCount,
        status: result.success ? 'sent' : 'failed',
        httpStatus: result.httpStatus,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      });
      if (result.success) {
        delivery.status = 'sent';
        delivery.deliveredAt = result.finishedAt;
        delivery.nextAttemptAt = null;
        delivery.lastError = null;
      } else if (
        result.retryable &&
        delivery.attemptCount < delivery.maxAttempts
      ) {
        const base = retryBaseMs();
        const delay = Math.min(
          base * 5 ** Math.max(0, delivery.attemptCount - 1),
          30 * 60_000,
        );
        delivery.status = 'retry_scheduled';
        delivery.nextAttemptAt = new Date(Date.now() + delay);
        delivery.lastError = result.errorMessage;
      } else {
        delivery.status = 'failed';
        delivery.nextAttemptAt = null;
        delivery.lastError = result.errorMessage;
      }
      await repository.save(delivery);
    });
  }

  async dispatchPending() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.recoverInterruptedDeliveries();
      await this.routeNotifications();
      for (let index = 0; index < 25; index += 1) {
        const delivery = await this.claimDelivery();
        if (!delivery) break;
        const result = delivery.channel
          ? await sendToChannel(
              delivery.channel,
              {
                event: 'family.notification',
                deliveryId: delivery.id,
                notification: {
                  id: delivery.notification.id,
                  module: delivery.notification.module,
                  type: delivery.notification.type,
                  title: delivery.notification.title,
                  body: delivery.notification.body,
                  targetPath: delivery.notification.targetPath,
                  createdAt: delivery.notification.createdAt.toISOString(),
                },
                recipient: {
                  id: delivery.recipient.id,
                  name: delivery.recipient.name,
                },
              },
              delivery.id,
            )
          : configurationFailure('通知渠道已删除');
        await this.finalizeDelivery(delivery, result);
        // 投递记录页原来 30 秒轮询：每条投递定稿后推 notifications
        this.events.publish({ householdId: delivery.householdId, domains: ['notifications'] });
      }
    } catch (error) {
      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'driverError' in error &&
        typeof error.driverError === 'object' &&
        error.driverError !== null &&
        'code' in error.driverError
          ? String(error.driverError.code)
          : null;
      console.error(
        JSON.stringify({
          event: 'external_notification_dispatch_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode,
        }),
      );
    } finally {
      this.dispatching = false;
    }
  }
}
