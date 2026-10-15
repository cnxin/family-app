import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import { MemberNotificationPreference, NotificationChannel } from '../entities';
import { isUniqueViolation } from '@family/shared';
import {
  ALL_NOTIFICATION_MODULES,
  CreateNotificationChannelInput,
  UpdateNotificationChannelInput,
  UpdateNotificationPreferenceInput,
  normalizedName,
  normalizedEndpoint,
  normalizedCredential,
  channelView,
} from './external-notifications.helpers';
import { sendToChannel } from './external-notifications.send';

@Injectable()
export class ExternalNotificationsService {
  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channels: Repository<NotificationChannel>,
    @InjectRepository(MemberNotificationPreference)
    private readonly preferences: Repository<MemberNotificationPreference>,
    private readonly dataSource: DataSource,
  ) {}

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
      channelView(channel, byChannel.get(channel.id)),
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
    const result = await sendToChannel(
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
    return channelView(channel, preference ?? undefined);
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
}
