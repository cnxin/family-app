import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import {
  MemberNotificationPreference,
  Notification,
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryStatus,
  NotificationModule,
} from '../entities';
import { isHouseholdManager, isUniqueViolation } from '@family/shared';

const ALL_NOTIFICATION_MODULES: NotificationModule[] = [
  'menu',
  'task',
  'poll',
  'calendar',
  'reminder',
  'media',
  'guest',
  'points',
  'agent',
  'system',
];
const AUTO_ATTEMPTS = 4;

export interface CreateNotificationChannelInput {
  name: string;
  kind: NotificationChannelKind;
  endpoint: string;
  credential?: string;
  isEnabled?: boolean;
}

export interface UpdateNotificationChannelInput {
  name?: string;
  kind?: NotificationChannelKind;
  endpoint?: string;
  credential?: string;
  clearCredential?: boolean;
  isEnabled?: boolean;
}

export interface UpdateNotificationPreferenceInput {
  isEnabled: boolean;
  modules: NotificationModule[];
}

interface SendResult {
  success: boolean;
  retryable: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date;
}

function normalizedName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new BadRequestException('渠道名称需要填写且不能超过 120 字');
  }
  return name;
}

function normalizedEndpoint(value: string) {
  const endpoint = value.trim();
  if (endpoint.length > 2000) {
    throw new BadRequestException('渠道地址不能超过 2000 字');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BadRequestException('渠道地址必须是完整的 HTTP 或 HTTPS 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('渠道地址只支持 HTTP 或 HTTPS');
  }
  if (url.username || url.password) {
    throw new BadRequestException('渠道地址不能包含用户名或密码');
  }
  url.hash = '';
  return {
    value: url.toString(),
    hint: `${url.protocol}//${url.host}`,
  };
}

function normalizedCredential(value: string) {
  const credential = value.trim();
  if (credential.length < 4 || credential.length > 2000) {
    throw new BadRequestException('渠道凭据长度需要在 4 到 2000 字之间');
  }
  return credential;
}

@Injectable()
export class ExternalNotificationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channels: Repository<NotificationChannel>,
    @InjectRepository(MemberNotificationPreference)
    private readonly preferences: Repository<MemberNotificationPreference>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveries: Repository<NotificationDelivery>,
    @InjectRepository(NotificationDeliveryAttempt)
    private readonly attempts: Repository<NotificationDeliveryAttempt>,
    private readonly dataSource: DataSource,
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

  async listChannels(user: JwtUser) {
    const [channels, preferences] = await Promise.all([
      this.channels.find({
        where: { householdId: user.householdId },
        order: { createdAt: 'ASC' },
      }),
      this.preferences.find({
        where: {
          householdId: user.householdId,
          memberId: user.memberId,
        },
      }),
    ]);
    const byChannel = new Map(
      preferences.map((preference) => [preference.channelId, preference]),
    );
    return channels.map((channel) =>
      this.channelView(channel, byChannel.get(channel.id)),
    );
  }

  async createChannel(input: CreateNotificationChannelInput, user: JwtUser) {
    const id = randomUUID();
    const endpoint = normalizedEndpoint(input.endpoint);
    const credential = input.credential
      ? normalizedCredential(input.credential)
      : null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(NotificationChannel);
        await repository.save(
          repository.create({
            id,
            householdId: user.householdId,
            name: normalizedName(input.name),
            kind: input.kind,
            endpointEncrypted: encryptIntegrationCredential(
              endpoint.value,
              user.householdId,
              `notification-channel:${id}:endpoint`,
            ),
            endpointHint: endpoint.hint,
            credentialEncrypted: credential
              ? encryptIntegrationCredential(
                  credential,
                  user.householdId,
                  `notification-channel:${id}:credential`,
                )
              : null,
            credentialHint: credential
              ? integrationCredentialHint(credential)
              : null,
            isEnabled: input.isEnabled ?? true,
            createdById: user.memberId,
            lastTestedAt: null,
            lastTestStatus: null,
            lastTestError: null,
          }),
        );
        await recordActivity(manager, user, {
          module: 'system',
          action: 'notification_channel_created',
          summary: `创建了外部通知渠道「${normalizedName(input.name)}」`,
          targetPath: '/notifications?view=settings',
          metadata: { channelId: id, kind: input.kind },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('已存在同名外部通知渠道');
      }
      throw error;
    }
    return this.channelForUser(id, user);
  }

  async updateChannel(
    id: string,
    input: UpdateNotificationChannelInput,
    user: JwtUser,
  ) {
    if (input.credential !== undefined && input.clearCredential) {
      throw new BadRequestException('不能同时填写和清除渠道凭据');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(NotificationChannel);
        const channel = await repository
          .createQueryBuilder('channel')
          .addSelect('channel.endpointEncrypted')
          .addSelect('channel.credentialEncrypted')
          .where('channel.id = :id', { id })
          .andWhere('channel.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!channel) throw new NotFoundException('外部通知渠道不存在');

        if (input.name !== undefined) channel.name = normalizedName(input.name);
        if (input.kind !== undefined) channel.kind = input.kind;
        if (input.isEnabled !== undefined) channel.isEnabled = input.isEnabled;
        if (input.endpoint !== undefined) {
          const endpoint = normalizedEndpoint(input.endpoint);
          channel.endpointEncrypted = encryptIntegrationCredential(
            endpoint.value,
            user.householdId,
            `notification-channel:${id}:endpoint`,
          );
          channel.endpointHint = endpoint.hint;
        }
        if (input.clearCredential) {
          channel.credentialEncrypted = null;
          channel.credentialHint = null;
        } else if (input.credential !== undefined) {
          const credential = normalizedCredential(input.credential);
          channel.credentialEncrypted = encryptIntegrationCredential(
            credential,
            user.householdId,
            `notification-channel:${id}:credential`,
          );
          channel.credentialHint = integrationCredentialHint(credential);
        }
        if (
          input.endpoint !== undefined ||
          input.credential !== undefined ||
          input.clearCredential
        ) {
          channel.lastTestedAt = null;
          channel.lastTestStatus = null;
          channel.lastTestError = null;
        }
        await repository.save(channel);
        await recordActivity(manager, user, {
          module: 'system',
          action: 'notification_channel_updated',
          summary: `更新了外部通知渠道「${channel.name}」`,
          targetPath: '/notifications?view=settings',
          metadata: { channelId: channel.id, kind: channel.kind },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('已存在同名外部通知渠道');
      }
      throw error;
    }
    return this.channelForUser(id, user);
  }

  async deleteChannel(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationChannel);
      const channel = await repository.findOneBy({
        id,
        householdId: user.householdId,
      });
      if (!channel) throw new NotFoundException('外部通知渠道不存在');
      await repository.remove(channel);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'notification_channel_deleted',
        summary: `删除了外部通知渠道「${channel.name}」`,
        targetPath: '/notifications?view=settings',
        metadata: {
          channelId: channel.id,
          kind: channel.kind,
          endpointHint: channel.endpointHint,
        },
      });
      return { id, deleted: true };
    });
  }

  async testChannel(id: string, user: JwtUser) {
    const channel = await this.channelWithSecrets(id, user.householdId);
    const result = await this.sendToChannel(
      channel,
      {
        event: 'family.notification.test',
        deliveryId: `test:${randomUUID()}`,
        notification: {
          id: null,
          module: 'system',
          type: 'channel_test',
          title: '小管家通知渠道测试',
          body: `「${channel.name}」已经可以接收家庭通知。`,
          targetPath: '/notifications?view=settings',
          createdAt: new Date().toISOString(),
        },
        recipient: { id: user.memberId, name: user.name },
      },
      `test-${randomUUID()}`,
    );
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(NotificationChannel).update(
        { id: channel.id, householdId: user.householdId },
        {
          lastTestedAt: result.finishedAt,
          lastTestStatus: result.success ? 'success' : 'failed',
          lastTestError: result.errorMessage,
        },
      );
      await recordActivity(manager, user, {
        module: 'system',
        action: result.success
          ? 'notification_channel_test_succeeded'
          : 'notification_channel_test_failed',
        summary: `${result.success ? '测试通过' : '测试失败'}：${channel.name}`,
        targetPath: '/notifications?view=settings',
        metadata: {
          channelId: channel.id,
          kind: channel.kind,
          status: result.httpStatus,
          errorCode: result.errorCode,
        },
      });
    });
    if (!result.success) {
      throw new BadGatewayException(
        `测试投递失败：${result.errorMessage ?? '外部服务不可用'}`,
      );
    }
    return { success: true, testedAt: result.finishedAt };
  }

  async updatePreference(
    channelId: string,
    input: UpdateNotificationPreferenceInput,
    user: JwtUser,
  ) {
    const channel = await this.channels.findOneBy({
      id: channelId,
      householdId: user.householdId,
    });
    if (!channel) throw new NotFoundException('外部通知渠道不存在');
    const modules = [...new Set(input.modules)];
    if (
      !modules.length ||
      modules.some((module) => !ALL_NOTIFICATION_MODULES.includes(module))
    ) {
      throw new BadRequestException('至少选择一个有效的通知模块');
    }
    let preference = await this.preferences.findOneBy({
      householdId: user.householdId,
      memberId: user.memberId,
      channelId,
    });
    preference ??= this.preferences.create({
      householdId: user.householdId,
      memberId: user.memberId,
      channelId,
    });
    preference.isEnabled = input.isEnabled;
    preference.modules = modules;
    const saved = await this.preferences.save(preference);
    return {
      id: saved.id,
      channelId: saved.channelId,
      memberId: saved.memberId,
      isEnabled: saved.isEnabled,
      modules: saved.modules,
      updatedAt: saved.updatedAt,
    };
  }

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
    void this.dispatchPending();
    return result;
  }

  private channelView(
    channel: NotificationChannel,
    preference?: MemberNotificationPreference,
  ) {
    return {
      id: channel.id,
      householdId: channel.householdId,
      name: channel.name,
      kind: channel.kind,
      endpointHint: channel.endpointHint,
      credentialConfigured: Boolean(channel.credentialHint),
      credentialHint: channel.credentialHint,
      isEnabled: channel.isEnabled,
      createdBy: channel.createdBy,
      lastTestedAt: channel.lastTestedAt,
      lastTestStatus: channel.lastTestStatus,
      lastTestError: channel.lastTestError,
      preference: preference
        ? {
            id: preference.id,
            isEnabled: preference.isEnabled,
            modules: preference.modules,
            updatedAt: preference.updatedAt,
          }
        : {
            id: null,
            isEnabled: false,
            modules: ALL_NOTIFICATION_MODULES,
            updatedAt: null,
          },
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  private async channelForUser(id: string, user: JwtUser) {
    const channel = await this.channels.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!channel) throw new NotFoundException('外部通知渠道不存在');
    const preference = await this.preferences.findOneBy({
      householdId: user.householdId,
      memberId: user.memberId,
      channelId: id,
    });
    return this.channelView(channel, preference ?? undefined);
  }

  private async channelWithSecrets(id: string, householdId: string) {
    const channel = await this.channels
      .createQueryBuilder('channel')
      .addSelect('channel.endpointEncrypted')
      .addSelect('channel.credentialEncrypted')
      .where('channel.id = :id', { id })
      .andWhere('channel.householdId = :householdId', { householdId })
      .getOne();
    if (!channel) throw new NotFoundException('外部通知渠道不存在');
    return channel;
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
        const base = this.retryBaseMs();
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

  private async dispatchPending() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.recoverInterruptedDeliveries();
      await this.routeNotifications();
      for (let index = 0; index < 25; index += 1) {
        const delivery = await this.claimDelivery();
        if (!delivery) break;
        const result = delivery.channel
          ? await this.sendToChannel(
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
          : this.configurationFailure('通知渠道已删除');
        await this.finalizeDelivery(delivery, result);
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

  private async sendToChannel(
    channel: NotificationChannel,
    payload: {
      event: string;
      deliveryId: string;
      notification: {
        id: string | null;
        module: NotificationModule;
        type: string;
        title: string;
        body: string | null;
        targetPath: string;
        createdAt: string;
      };
      recipient: { id: string; name: string };
    },
    idempotencyKey: string,
  ): Promise<SendResult> {
    const startedAt = new Date();
    if (!channel.isEnabled) return this.configurationFailure('通知渠道已停用');
    let endpoint: string;
    let credential: string | null;
    try {
      endpoint = decryptIntegrationCredential(
        channel.endpointEncrypted,
        channel.householdId,
        `notification-channel:${channel.id}:endpoint`,
        '通知渠道地址',
      )!;
      credential = decryptIntegrationCredential(
        channel.credentialEncrypted,
        channel.householdId,
        `notification-channel:${channel.id}:credential`,
        '通知渠道',
      );
    } catch {
      return this.configurationFailure('通知渠道配置无法解密', startedAt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs());
    try {
      const body =
        channel.kind === 'ntfy'
          ? {
              title: payload.notification.title,
              message: [payload.notification.body, payload.notification.targetPath]
                .filter(Boolean)
                .join('\n'),
            }
          : payload;
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Family-Notification-Event': payload.event,
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
      });
      await response.body?.cancel();
      const finishedAt = new Date();
      if (response.ok) {
        return {
          success: true,
          retryable: false,
          httpStatus: response.status,
          errorCode: null,
          errorMessage: null,
          startedAt,
          finishedAt,
        };
      }
      const retryable =
        response.status >= 500 ||
        [408, 409, 425, 429].includes(response.status);
      return {
        success: false,
        retryable,
        httpStatus: response.status,
        errorCode: `HTTP_${response.status}`,
        errorMessage: `外部服务返回 HTTP ${response.status}`,
        startedAt,
        finishedAt,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        success: false,
        retryable: true,
        httpStatus: null,
        errorCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: timedOut ? '外部服务响应超时' : '无法连接外部服务',
        startedAt,
        finishedAt: new Date(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private configurationFailure(message: string, startedAt = new Date()) {
    return {
      success: false,
      retryable: false,
      httpStatus: null,
      errorCode: 'CONFIGURATION_ERROR',
      errorMessage: message,
      startedAt,
      finishedAt: new Date(),
    } satisfies SendResult;
  }

  private requestTimeoutMs() {
    const configured = Number(
      process.env.NOTIFICATION_DELIVERY_TIMEOUT_MS || 5_000,
    );
    return Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 30_000))
      : 5_000;
  }

  private retryBaseMs() {
    const configured = Number(
      process.env.NOTIFICATION_DELIVERY_RETRY_BASE_MS || 60_000,
    );
    return Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 30 * 60_000))
      : 60_000;
  }
}
