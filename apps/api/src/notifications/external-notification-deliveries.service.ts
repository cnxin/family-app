import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryStatus,
} from '../entities';
import { isHouseholdManager } from '@family/shared';
import { AUTO_ATTEMPTS } from './external-notifications.helpers';
import { ExternalNotificationsDispatcher } from './external-notifications.dispatcher';

/** 外部通知投递记录：列表与手动重试（J7.2 从 ExternalNotificationsService 拆出）。 */
@Injectable()
export class ExternalNotificationDeliveriesService {
  constructor(
    @InjectRepository(NotificationDelivery)
    private readonly deliveries: Repository<NotificationDelivery>,
    @InjectRepository(NotificationDeliveryAttempt)
    private readonly attempts: Repository<NotificationDeliveryAttempt>,
    private readonly dataSource: DataSource,
    private readonly dispatcher: ExternalNotificationsDispatcher,
  ) {}

  async listDeliveries(
    status: NotificationDeliveryStatus | 'all' | undefined,
    user: JwtUser,
  ) {
    const rows = await this.deliveries.find({
      where: {
        householdId: user.householdId,
        ...(isHouseholdManager(user) ? {} : { recipientId: user.memberId }),
        ...(!status || status === 'all' ? {} : { status }),
      },
      order: { createdAt: 'DESC' },
      take: 80,
    });
    const attempts = rows.length
      ? await this.attempts.find({
          where: { deliveryId: In(rows.map((row) => row.id)) },
          order: { createdAt: 'DESC' },
        })
      : [];
    const byDelivery = new Map<string, NotificationDeliveryAttempt[]>();
    for (const attempt of attempts) {
      const list = byDelivery.get(attempt.deliveryId) ?? [];
      list.push(attempt);
      byDelivery.set(attempt.deliveryId, list);
    }
    return rows.map((row) => ({
      ...row,
      attempts: byDelivery.get(row.id) ?? [],
      canRetry:
        row.status === 'failed' &&
        Boolean(row.channelId) &&
        (isHouseholdManager(user) || row.recipientId === user.memberId),
    }));
  }

  async retryDelivery(id: string, user: JwtUser) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationDelivery);
      const delivery = await repository
        .createQueryBuilder('delivery')
        .leftJoinAndSelect('delivery.channel', 'channel')
        .where('delivery.id = :id', { id })
        .andWhere('delivery.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write', undefined, ['delivery'])
        .getOne();
      if (!delivery) throw new NotFoundException('外部通知投递不存在');
      if (!isHouseholdManager(user) && delivery.recipientId !== user.memberId) {
        throw new NotFoundException('外部通知投递不存在');
      }
      if (delivery.status !== 'failed') {
        throw new ConflictException('只有失败的投递可以重试');
      }
      if (!delivery.channel || !delivery.channel.isEnabled) {
        throw new ConflictException('通知渠道已停用或删除，不能重试');
      }
      delivery.status = 'pending';
      delivery.maxAttempts = delivery.attemptCount + AUTO_ATTEMPTS;
      delivery.nextAttemptAt = new Date();
      delivery.lastError = null;
      await repository.save(delivery);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'notification_delivery_retried',
        summary: `重新投递了「${delivery.notification?.title ?? delivery.channelName}」`,
        targetPath: '/notifications?view=deliveries',
        metadata: { deliveryId: delivery.id, channelId: delivery.channelId },
      });
      return delivery;
    });
    void this.dispatcher.dispatchPending();
    return result;
  }
}
