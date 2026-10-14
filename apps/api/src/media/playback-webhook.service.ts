import { EventBus } from '../events/event-bus';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  Integration,
  IntegrationEvent,
  MediaLibraryItem,
  MediaLibraryProviderKind,
  MediaUserMapping,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import {
  canonicalizeWebhookValue,
  hashWebhookValue,
  literalIpFromBaseUrl,
  normalizeWebhookSourceIp,
  webhookSecretMatches,
} from './moviepilot-webhook.service';
import {
  NormalizedPlaybackEvent,
  text,
  parsePlexPayload,
  normalize,
  auditSnapshot,
} from './playback-webhook.normalize';
import { mergeSession, mergeParticipant, mergeProgress } from './playback-webhook.merge';

const MAX_WEBHOOK_BYTES = 64 * 1024;

@Injectable()
export class PlaybackWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
    private readonly events: EventBus,
  ) {}

  isProvider(value: string): value is MediaLibraryProviderKind {
    return value === 'plex' || value === 'emby';
  }

  async rotate(
    provider: MediaLibraryProviderKind,
    sourceIp: string | undefined,
    user: JwtUser,
  ) {
    const [directory] = await this.connectors.playbackUsers(user.householdId, provider);
    if (!directory || directory.state !== 'online' || !directory.serverId) {
      throw new BadGatewayException(directory?.message ?? '媒体服务当前不可用');
    }
    const secret = randomBytes(32).toString('base64url');
    const updatedAt = new Date();
    const result = await this.dataSource.transaction(async (manager) => {
      const integration = await manager
        .getRepository(Integration)
        .createQueryBuilder('integration')
        .addSelect('integration.webhookSecretHash')
        .where('integration.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('integration.kind = :provider', { provider })
        .andWhere('integration.isEnabled = true')
        .setLock('pessimistic_write', undefined, ['integration'])
        .getOne();
      if (!integration) throw new BadRequestException(`请先保存 ${provider === 'plex' ? 'Plex' : 'Emby'} 连接设置`);
      const normalizedSourceIp = normalizeWebhookSourceIp(
        sourceIp ?? integration.webhookSourceIp ?? literalIpFromBaseUrl(integration.baseUrl),
      );
      if (!normalizedSourceIp) {
        throw new BadRequestException('回调来源 IP 必须是有效的 IPv4 或 IPv6 地址');
      }
      const wasConfigured = Boolean(integration.webhookSecretHash);
      integration.webhookSecretHash = hashWebhookValue(secret);
      integration.webhookSourceIp = normalizedSourceIp;
      integration.webhookUpdatedAt = updatedAt;
      integration.settings = {
        ...integration.settings,
        playbackServerId: directory.serverId,
      };
      await manager.getRepository(Integration).save(integration);
      await recordActivity(manager, user, {
        module: 'media',
        action: wasConfigured ? 'playback_webhook_rotated' : 'playback_webhook_created',
        summary: `${wasConfigured ? '更新' : '创建'}了 ${provider === 'plex' ? 'Plex' : 'Emby'} 播放回调地址`,
        targetPath: '/media/settings?section=services',
        metadata: { provider, serverId: directory.serverId },
      });
      return { integrationId: integration.id, sourceIp: normalizedSourceIp };
    });
    return {
      callbackPath: `/media/webhooks/playback/${provider}/${result.integrationId}/${secret}`,
      sourceIp: result.sourceIp,
      serverId: directory.serverId,
      updatedAt,
    };
  }

  /** webhook 是公开端点，拦截器不知道是哪家；处理成功后按 integration 所属家庭发 media 事件。 */
  async receive(
    provider: MediaLibraryProviderKind,
    integrationId: string,
    secret: string,
    request: Request,
    body: unknown,
  ) {
    const result = await this.receiveUnpublished(provider, integrationId, secret, request, body);
    const integration = await this.dataSource
      .getRepository(Integration)
      .findOne({ where: { id: integrationId }, select: { id: true, householdId: true } });
    if (integration?.householdId) this.events.publish({ householdId: integration.householdId, domains: ['media'] });
    return result;
  }

  private async receiveUnpublished(
    provider: MediaLibraryProviderKind,
    integrationId: string,
    secret: string,
    request: Request,
    body: unknown,
  ) {
    const integration = await this.dataSource
      .getRepository(Integration)
      .createQueryBuilder('integration')
      .addSelect('integration.webhookSecretHash')
      .where('integration.id = :integrationId', { integrationId })
      .andWhere('integration.kind = :provider', { provider })
      .andWhere('integration.isEnabled = true')
      .getOne();
    if (
      !integration?.webhookSecretHash ||
      !webhookSecretMatches(secret, integration.webhookSecretHash)
    ) {
      throw new NotFoundException('播放回调不存在');
    }
    const requestIp = normalizeWebhookSourceIp(request.ip || request.socket.remoteAddress);
    if (!requestIp || requestIp !== integration.webhookSourceIp) {
      throw new ForbiddenException('回调来源不在允许范围内');
    }

    const receivedAt = new Date();
    const payload = provider === 'plex' ? parsePlexPayload(body) : body;
    const serialized = JSON.stringify(canonicalizeWebhookValue(payload));
    if (Buffer.byteLength(serialized, 'utf8') > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException('播放回调数据不能超过 64 KiB');
    }
    const event = normalize(provider, body, receivedAt);
    if (!event) {
      return { accepted: true, ignored: true, duplicate: false, matched: false };
    }

    const snapshot = auditSnapshot(event);
    const idempotencyKey = hashWebhookValue(serialized);
    const inserted = (await this.dataSource.query(
      `INSERT INTO "integration_events"
        ("householdId", "integrationId", "provider", "eventType",
         "idempotencyKey", "status", "payload", "error")
       VALUES ($1, $2, $3, $4, $5, 'failed', $6::jsonb, $7)
       ON CONFLICT ("integrationId", "idempotencyKey") DO NOTHING
       RETURNING "id"`,
      [
        integration.householdId,
        integration.id,
        provider,
        event.sourceEventType,
        idempotencyKey,
        JSON.stringify(snapshot),
        '事件尚未处理',
      ],
    )) as { id: string }[];
    const eventId = inserted[0]?.id;
    if (!eventId) {
      return { accepted: true, ignored: false, duplicate: true, matched: false };
    }

    try {
      const result = await this.dataSource.transaction((manager) =>
        this.process(manager, eventId, integration, event),
      );
      return {
        accepted: true,
        ignored: !result,
        duplicate: false,
        matched: Boolean(result),
        viewingSessionId: result?.id ?? null,
      };
    } catch {
      await this.dataSource.getRepository(IntegrationEvent).update(eventId, {
        status: 'failed',
        error: '播放回调处理失败',
        processedAt: new Date(),
      });
      throw new InternalServerErrorException('播放回调处理失败');
    }
  }

  private async ignore(manager: EntityManager, eventId: string, reason: string) {
    await manager.getRepository(IntegrationEvent).update(eventId, {
      status: 'ignored',
      error: reason,
      processedAt: new Date(),
    });
    return null;
  }

  private async process(
    manager: EntityManager,
    eventId: string,
    integration: Integration,
    event: NormalizedPlaybackEvent,
  ) {
    const configuredServerId = text(integration.settings.playbackServerId, 180);
    if (!configuredServerId || configuredServerId !== event.serverId) {
      return this.ignore(manager, eventId, '事件来自旧服务器或尚未确认的服务器');
    }
    const mapping = await manager
      .getRepository(MediaUserMapping)
      .createQueryBuilder('mapping')
      .innerJoinAndSelect('mapping.member', 'member')
      .where('mapping.householdId = :householdId', {
        householdId: integration.householdId,
      })
      .andWhere('mapping.provider = :provider', { provider: event.provider })
      .andWhere('mapping.connectorKey = :connectorKey', {
        connectorKey: event.provider,
      })
      .andWhere('mapping.serverId = :serverId', { serverId: event.serverId })
      .andWhere('mapping.externalUserId = :externalUserId', {
        externalUserId: event.externalUserId,
      })
      .andWhere('member.disabledAt IS NULL')
      .getOne();
    if (!mapping) return this.ignore(manager, eventId, '外部用户未映射到有效家庭成员');

    const libraryItem = await manager.getRepository(MediaLibraryItem).findOneBy({
      householdId: integration.householdId,
      provider: event.provider,
      connectorKey: event.provider,
      libraryItemId: event.libraryItemId,
    });
    if (!libraryItem) return this.ignore(manager, eventId, '媒体项尚未同步到家庭媒体库');

    const session = await mergeSession(manager, integration, event, libraryItem);
    await mergeParticipant(manager, session, mapping, event);
    await mergeProgress(manager, session, mapping, event, libraryItem);
    await manager.getRepository(IntegrationEvent).update(eventId, {
      status: 'processed',
      error: null,
      viewingSessionId: session.id,
      processedAt: new Date(),
    });
    return session;
  }
}
