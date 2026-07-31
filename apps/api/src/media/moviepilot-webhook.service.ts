import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { isIP } from 'net';
import { DataSource, EntityManager } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  Integration,
  IntegrationEvent,
  MediaRequest,
  Notification,
} from '../entities';

const MAX_WEBHOOK_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;

interface TransferCompleteSnapshot extends JsonObject {
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  mediaType: string | null;
  tmdbId: string | null;
  season: number | null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function canonicalizeWebhookValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeWebhookValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeWebhookValue(value[key])]),
  );
}

export function hashWebhookValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeWebhookSourceIp(value: string | null | undefined) {
  let normalized = value?.trim() ?? '';
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.toLowerCase().startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex);
  return isIP(normalized) ? normalized.toLowerCase() : null;
}

export function literalIpFromBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return normalizeWebhookSourceIp(new URL(value).hostname);
  } catch {
    return null;
  }
}

export function webhookSecretMatches(secret: string, storedHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const actual = createHash('sha256').update(secret).digest();
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function transferSnapshot(body: JsonObject): TransferCompleteSnapshot {
  const data = isObject(body.data) ? body.data : {};
  const mediaInfo = isObject(data.mediainfo) ? data.mediainfo : {};
  const meta = isObject(data.meta) ? data.meta : {};
  const rawTmdbId = mediaInfo.tmdb_id ?? mediaInfo.tmdbId;
  const tmdbId = integer(rawTmdbId, 1, Number.MAX_SAFE_INTEGER);
  return {
    title: trimmedString(mediaInfo.title, 180),
    originalTitle: trimmedString(mediaInfo.original_title, 180),
    year: integer(mediaInfo.year, 1878, 2199),
    mediaType: trimmedString(mediaInfo.type, 32),
    tmdbId: tmdbId == null ? null : String(tmdbId),
    season: integer(meta.begin_season, 1, 999),
  };
}

function normalizeMoviePilotEventType(value: string | null) {
  return value === 'TransferComplete' || value === 'transfer.complete'
    ? 'TransferComplete'
    : value;
}

@Injectable()
export class MoviePilotWebhookService {
  constructor(private readonly dataSource: DataSource) {}

  async rotate(sourceIp: string | undefined, user: JwtUser) {
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
        .andWhere('integration.kind = :kind', { kind: 'moviepilot' })
        .setLock('pessimistic_write', undefined, ['integration'])
        .getOne();
      if (!integration) {
        throw new BadRequestException('请先保存 MoviePilot 家庭连接设置');
      }
      const normalizedSourceIp = normalizeWebhookSourceIp(
        sourceIp ??
          integration.webhookSourceIp ??
          literalIpFromBaseUrl(integration.baseUrl),
      );
      if (!normalizedSourceIp) {
        throw new BadRequestException('回调来源 IP 必须是有效的 IPv4 或 IPv6 地址');
      }
      const wasConfigured = Boolean(integration.webhookSecretHash);
    integration.webhookSecretHash = hashWebhookValue(secret);
      integration.webhookSourceIp = normalizedSourceIp;
      integration.webhookUpdatedAt = updatedAt;
      await manager.getRepository(Integration).save(integration);
      await recordActivity(manager, user, {
        module: 'media',
        action: wasConfigured
          ? 'moviepilot_webhook_rotated'
          : 'moviepilot_webhook_created',
        summary: `${wasConfigured ? '更新' : '创建'}了 MoviePilot 回调地址`,
        targetPath: '/media/settings?section=services',
        metadata: { kind: 'moviepilot' },
      });
      return { integrationId: integration.id, sourceIp: normalizedSourceIp };
    });

    return {
      callbackPath: `/media/webhooks/moviepilot/${result.integrationId}/${secret}`,
      sourceIp: result.sourceIp,
      updatedAt,
    };
  }

  async receive(
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
      .andWhere('integration.kind = :kind', { kind: 'moviepilot' })
      .andWhere('integration.isEnabled = true')
      .getOne();
    if (
      !integration?.webhookSecretHash ||
      !webhookSecretMatches(secret, integration.webhookSecretHash)
    ) {
      throw new NotFoundException('MoviePilot 回调不存在');
    }

    const requestIp = normalizeWebhookSourceIp(
      request.ip || request.socket.remoteAddress,
    );
    if (!requestIp || requestIp !== integration.webhookSourceIp) {
      throw new ForbiddenException('回调来源不在允许范围内');
    }
    if (!isObject(body)) throw new BadRequestException('回调数据格式无效');

    const rawSerialized = JSON.stringify(canonicalizeWebhookValue(body));
    if (Buffer.byteLength(rawSerialized, 'utf8') > MAX_WEBHOOK_BYTES) {
      throw new PayloadTooLargeException('MoviePilot 回调数据不能超过 64 KiB');
    }
    const eventType = normalizeMoviePilotEventType(
      trimmedString(body.type, 80),
    );
    if (eventType !== 'TransferComplete') {
      return { accepted: true, ignored: true, duplicate: false, matched: false };
    }

    const snapshot = transferSnapshot(body);
    const serialized = JSON.stringify(
      canonicalizeWebhookValue({ ...body, type: eventType }),
    );
    const idempotencyKey = hashWebhookValue(serialized);
    const inserted = (await this.dataSource.query(
      `INSERT INTO "integration_events"
        ("householdId", "integrationId", "provider", "eventType",
         "idempotencyKey", "status", "payload", "error")
       VALUES ($1, $2, 'moviepilot', $3, $4, 'failed', $5::jsonb, $6)
       ON CONFLICT ("integrationId", "idempotencyKey") DO NOTHING
       RETURNING "id"`,
      [
        integration.householdId,
        integration.id,
        eventType,
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
      const matched = await this.dataSource.transaction((manager) =>
        this.processTransfer(manager, eventId, integration, snapshot),
      );
      return {
        accepted: true,
        ignored: !matched,
        duplicate: false,
        matched,
      };
    } catch {
      await this.dataSource.getRepository(IntegrationEvent).update(eventId, {
        status: 'failed',
        error: 'MoviePilot 回调处理失败',
        processedAt: new Date(),
      });
      throw new InternalServerErrorException('MoviePilot 回调处理失败');
    }
  }

  private async processTransfer(
    manager: EntityManager,
    eventId: string,
    integration: Integration,
    snapshot: TransferCompleteSnapshot,
  ) {
    const events = manager.getRepository(IntegrationEvent);
    if (!snapshot.tmdbId) {
      await events.update(eventId, {
        status: 'ignored',
        error: '事件缺少有效的 TMDB ID',
        processedAt: new Date(),
      });
      return false;
    }

    const mediaRequest = await manager
      .getRepository(MediaRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.householdMedia', 'entry')
      .innerJoinAndSelect('entry.mediaTitle', 'title')
      .innerJoin('title.externalRefs', 'externalRef')
      .where('request.householdId = :householdId', {
        householdId: integration.householdId,
      })
      .andWhere('request.connectorKey = :connectorKey', {
        connectorKey: 'moviepilot',
      })
      .andWhere('request.status IN (:...statuses)', {
        statuses: ['pending', 'processing'],
      })
      .andWhere('externalRef.provider = :provider', { provider: 'tmdb' })
      .andWhere('externalRef.externalId = :tmdbId', {
        tmdbId: snapshot.tmdbId,
      })
      .andWhere(
        `((title.type = 'movie' AND request.season = 0)
          OR (title.type = 'series'
            AND CAST(:season AS integer) IS NOT NULL
            AND request.season = CAST(:season AS integer)))`,
        { season: snapshot.season },
      )
      .setLock('pessimistic_write', undefined, ['request'])
      .getOne();
    if (!mediaRequest) {
      await events.update(eventId, {
        status: 'ignored',
        error: '未匹配到进行中的家庭订阅',
        processedAt: new Date(),
      });
      return false;
    }

    const completedAt = new Date();
    mediaRequest.status = 'completed';
    mediaRequest.message = 'MoviePilot 已完成整理';
    mediaRequest.lastSyncedAt = completedAt;
    await manager.getRepository(MediaRequest).save(mediaRequest);
    await manager.getRepository(Notification).save(
      manager.getRepository(Notification).create({
        householdId: integration.householdId,
        recipientId: mediaRequest.requestedById,
        module: 'media',
        type: 'media_ready',
        sourceId: mediaRequest.householdMediaId,
        title: '影片已就绪',
        body: `「${mediaRequest.householdMedia.mediaTitle.title}」${
          mediaRequest.season ? `第 ${mediaRequest.season} 季` : ''
        }已完成整理，可以前往媒体库播放`,
        targetPath: `/media/watchlist?mediaId=${mediaRequest.householdMediaId}&view=detail`,
        readAt: null,
      }),
    );
    await events.update(eventId, {
      status: 'processed',
      error: null,
      mediaRequestId: mediaRequest.id,
      processedAt: completedAt,
    });
    return true;
  }
}
