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
  MediaType,
  MediaUserMapping,
  ViewingParticipant,
  ViewingProgress,
  ViewingSession,
  ViewingSessionStatus,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import {
  canonicalizeWebhookValue,
  hashWebhookValue,
  literalIpFromBaseUrl,
  normalizeWebhookSourceIp,
  webhookSecretMatches,
} from './moviepilot-webhook.service';

const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_EVENT_FUTURE_MS = 10 * 60 * 1000;
const OUT_OF_ORDER_MERGE_MS = 5 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type PlaybackEventState = 'start' | 'progress' | 'pause' | 'stop' | 'completed';

interface NormalizedPlaybackEvent {
  provider: MediaLibraryProviderKind;
  sourceEventType: string;
  state: PlaybackEventState;
  serverId: string;
  externalUserId: string;
  externalUserName: string | null;
  externalSessionId: string | null;
  playbackKey: string;
  libraryItemId: string;
  contentItemId: string;
  mediaType: MediaType;
  title: string;
  deviceName: string | null;
  positionMs: number;
  durationMs: number | null;
  eventAt: Date;
  explicitlyCompleted: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function firstValue(source: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function integer(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(2_147_483_647, Math.round(parsed))
    : null;
}

function ticksToMs(value: unknown) {
  const ticks = integer(value);
  return ticks == null ? null : Math.round(ticks / 10_000);
}

function boundedEventTime(value: unknown, receivedAt: Date) {
  let parsed: Date | null = null;
  if (value instanceof Date) parsed = value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    parsed = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = new Date(value < 10_000_000_000 ? value * 1000 : value);
  }
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getTime() < receivedAt.getTime() - MAX_EVENT_AGE_MS ||
    parsed.getTime() > receivedAt.getTime() + MAX_EVENT_FUTURE_MS
  ) {
    return receivedAt;
  }
  return parsed;
}

function eventStatus(event: NormalizedPlaybackEvent): ViewingSessionStatus {
  if (
    event.state === 'completed' ||
    event.explicitlyCompleted ||
    (event.state === 'stop' && percentage(event.positionMs, event.durationMs) >= 90)
  ) {
    return 'completed';
  }
  if (event.state === 'pause') return 'paused';
  if (event.state === 'stop') return 'stopped';
  return 'active';
}

function percentage(positionMs: number, durationMs: number | null) {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.max(0, Math.min(100, (positionMs / durationMs) * 100));
}

function parsePlexPayload(body: unknown) {
  if (!isObject(body)) throw new BadRequestException('Plex 回调数据格式无效');
  const payload = body.payload;
  if (isObject(payload)) return payload;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (isObject(parsed)) return parsed;
    } catch {
      throw new BadRequestException('Plex payload 不是有效 JSON');
    }
  }
  return body;
}

function normalizePlex(body: unknown, receivedAt: Date): NormalizedPlaybackEvent | null {
  const payload = parsePlexPayload(body);
  const sourceEventType = text(payload.event, 80)?.toLowerCase();
  const stateByType: Record<string, PlaybackEventState> = {
    'media.play': 'start',
    'media.resume': 'progress',
    'media.pause': 'pause',
    'media.stop': 'stop',
    'media.scrobble': 'completed',
    'media.progress': 'progress',
  };
  const state = sourceEventType ? stateByType[sourceEventType] : undefined;
  if (!sourceEventType || !state) return null;

  const account = object(firstValue(payload, 'Account', 'account'));
  const server = object(firstValue(payload, 'Server', 'server'));
  const player = object(firstValue(payload, 'Player', 'player'));
  const metadata = object(firstValue(payload, 'Metadata', 'metadata'));
  const session = object(firstValue(payload, 'Session', 'session'));
  const transcode = object(firstValue(payload, 'TranscodeSession', 'transcodeSession'));
  const serverId = text(firstValue(server, 'uuid', 'machineIdentifier', 'id'), 180);
  const externalUserId = text(firstValue(account, 'id', 'key'), 180);
  const contentItemId = text(firstValue(metadata, 'ratingKey', 'key'), 180)?.replace(
    /^\/library\/metadata\//,
    '',
  );
  const rawType = text(metadata.type, 32)?.toLowerCase();
  const mediaType: MediaType | null =
    rawType === 'movie' ? 'movie' : rawType === 'episode' || rawType === 'show' ? 'series' : null;
  const libraryItemId =
    mediaType === 'series'
      ? text(firstValue(metadata, 'grandparentRatingKey', 'seriesRatingKey'), 180) ??
        contentItemId
      : contentItemId;
  if (!serverId || !externalUserId || !contentItemId || !libraryItemId || !mediaType) {
    return null;
  }

  const episodeTitle = text(metadata.title, 180);
  const seriesTitle = text(firstValue(metadata, 'grandparentTitle', 'parentTitle'), 180);
  const title =
    mediaType === 'series' && seriesTitle && episodeTitle && seriesTitle !== episodeTitle
      ? `${seriesTitle} · ${episodeTitle}`.slice(0, 240)
      : episodeTitle ?? seriesTitle ?? '未命名影视';
  const playerId = text(firstValue(player, 'uuid', 'machineIdentifier', 'title'), 180) ?? 'unknown';
  const nativeSessionId = text(
    firstValue(session, 'id', 'key') ??
      firstValue(metadata, 'sessionKey') ??
      firstValue(transcode, 'key', 'sessionKey'),
    160,
  );
  const playbackKey = hashWebhookValue(
    ['plex', serverId, externalUserId, playerId, contentItemId].join(':'),
  );
  return {
    provider: 'plex',
    sourceEventType,
    state,
    serverId,
    externalUserId,
    externalUserName: text(firstValue(account, 'title', 'name'), 180),
    externalSessionId: nativeSessionId ? `native:${nativeSessionId}` : null,
    playbackKey,
    libraryItemId: libraryItemId.replace(/^\/library\/metadata\//, ''),
    contentItemId,
    mediaType,
    title,
    deviceName: text(firstValue(player, 'title', 'product'), 180),
    positionMs: integer(firstValue(metadata, 'viewOffset', 'view_offset')) ?? 0,
    durationMs: integer(metadata.duration),
    eventAt: boundedEventTime(
      firstValue(payload, 'timestamp', 'eventTime', 'event_time', 'createdAt'),
      receivedAt,
    ),
    explicitlyCompleted: state === 'completed',
  };
}

function normalizeEmby(body: unknown, receivedAt: Date): NormalizedPlaybackEvent | null {
  if (!isObject(body)) throw new BadRequestException('Emby 回调数据格式无效');
  const eventValue = text(firstValue(body, 'Event', 'event', 'NotificationType'), 80);
  if (!eventValue) return null;
  const normalizedType = eventValue.toLowerCase().replace(/[_\s-]+/g, '.');
  const compactType = normalizedType.replaceAll('.', '');
  const stateByType: Record<string, PlaybackEventState> = {
    playbackstart: 'start',
    mediaplay: 'start',
    playbackprogress: 'progress',
    playbackpause: 'pause',
    mediapause: 'pause',
    playbackstop: 'stop',
    mediastop: 'stop',
  };
  const state = stateByType[compactType];
  if (!state) return null;

  const user = object(firstValue(body, 'User', 'user'));
  const server = object(firstValue(body, 'Server', 'server'));
  const item = object(firstValue(body, 'Item', 'item'));
  const session = object(firstValue(body, 'Session', 'session'));
  const playState = object(firstValue(session, 'PlayState', 'playState'));
  const playbackInfo = object(firstValue(body, 'PlaybackInfo', 'playbackInfo'));
  const userData = object(firstValue(item, 'UserData', 'userData'));
  const serverId = text(firstValue(server, 'Id', 'id') ?? firstValue(body, 'ServerId'), 180);
  const externalUserId = text(firstValue(user, 'Id', 'id') ?? firstValue(body, 'UserId'), 180);
  const contentItemId = text(firstValue(item, 'Id', 'id') ?? firstValue(body, 'ItemId'), 180);
  const rawType = text(firstValue(item, 'Type', 'type'), 32)?.toLowerCase();
  const mediaType: MediaType | null =
    rawType === 'movie' ? 'movie' : rawType === 'episode' || rawType === 'series' ? 'series' : null;
  const libraryItemId =
    mediaType === 'series'
      ? text(firstValue(item, 'SeriesId', 'seriesId'), 180) ?? contentItemId
      : contentItemId;
  if (!serverId || !externalUserId || !contentItemId || !libraryItemId || !mediaType) {
    return null;
  }

  const itemTitle = text(firstValue(item, 'Name', 'name'), 180);
  const seriesTitle = text(firstValue(item, 'SeriesName', 'seriesName'), 180);
  const title =
    mediaType === 'series' && seriesTitle && itemTitle && seriesTitle !== itemTitle
      ? `${seriesTitle} · ${itemTitle}`.slice(0, 240)
      : itemTitle ?? seriesTitle ?? '未命名影视';
  const nativeSessionId = text(
    firstValue(session, 'Id', 'id') ?? firstValue(body, 'SessionId', 'PlaySessionId'),
    160,
  );
  const playerId =
    text(firstValue(session, 'DeviceId', 'deviceId', 'Id', 'id'), 180) ?? 'unknown';
  const playbackKey = hashWebhookValue(
    ['emby', serverId, externalUserId, playerId, contentItemId].join(':'),
  );
  const completed =
    firstValue(playbackInfo, 'PlayedToCompletion', 'playedToCompletion') === true ||
    firstValue(userData, 'Played', 'played') === true;
  return {
    provider: 'emby',
    sourceEventType: eventValue.slice(0, 80),
    state: completed ? 'completed' : state,
    serverId,
    externalUserId,
    externalUserName: text(firstValue(user, 'Name', 'name'), 180),
    externalSessionId: nativeSessionId ? `native:${nativeSessionId}` : null,
    playbackKey,
    libraryItemId,
    contentItemId,
    mediaType,
    title,
    deviceName: text(firstValue(session, 'DeviceName', 'deviceName', 'Client', 'client'), 180),
    positionMs:
      ticksToMs(
        firstValue(playState, 'PositionTicks', 'positionTicks') ??
          firstValue(playbackInfo, 'PositionTicks', 'positionTicks') ??
          firstValue(body, 'PlaybackPositionTicks') ??
          firstValue(userData, 'PlaybackPositionTicks', 'playbackPositionTicks'),
      ) ?? 0,
    durationMs:
      ticksToMs(
        firstValue(item, 'RunTimeTicks', 'runTimeTicks') ??
          firstValue(playbackInfo, 'RunTimeTicks', 'runTimeTicks'),
      ) ?? null,
    eventAt: boundedEventTime(
      firstValue(body, 'Timestamp', 'timestamp', 'Date', 'EventTime', 'CreatedAt'),
      receivedAt,
    ),
    explicitlyCompleted: completed,
  };
}

function normalize(
  provider: MediaLibraryProviderKind,
  body: unknown,
  receivedAt: Date,
) {
  return provider === 'plex'
    ? normalizePlex(body, receivedAt)
    : normalizeEmby(body, receivedAt);
}

function auditSnapshot(event: NormalizedPlaybackEvent) {
  return {
    eventType: event.sourceEventType,
    state: event.state,
    serverId: event.serverId,
    actorRef: hashWebhookValue(`${event.provider}:${event.externalUserId}`).slice(0, 16),
    sessionRef: hashWebhookValue(event.externalSessionId ?? event.playbackKey).slice(0, 16),
    libraryItemId: event.libraryItemId,
    contentItemId: event.contentItemId,
    mediaType: event.mediaType,
    title: event.title,
    positionMs: event.positionMs,
    durationMs: event.durationMs,
    eventAt: event.eventAt.toISOString(),
  };
}

@Injectable()
export class PlaybackWebhookService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
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

  async receive(
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

    const session = await this.mergeSession(manager, integration, event, libraryItem);
    await this.mergeParticipant(manager, session, mapping, event);
    await this.mergeProgress(manager, session, mapping, event, libraryItem);
    await manager.getRepository(IntegrationEvent).update(eventId, {
      status: 'processed',
      error: null,
      viewingSessionId: session.id,
      processedAt: new Date(),
    });
    return session;
  }

  private async mergeSession(
    manager: EntityManager,
    integration: Integration,
    event: NormalizedPlaybackEvent,
    libraryItem: MediaLibraryItem,
  ) {
    const repository = manager.getRepository(ViewingSession);
    let session: ViewingSession | null = null;
    if (event.externalSessionId) {
      session = await repository.findOneBy({
        integrationId: integration.id,
        serverId: event.serverId,
        externalSessionId: event.externalSessionId,
      });
    } else {
      const latest = await repository.findOne({
        where: {
          integrationId: integration.id,
          serverId: event.serverId,
          playbackKey: event.playbackKey,
        },
        order: { lastEventAt: 'DESC' },
      });
      const canReuse =
        latest &&
        (latest.status === 'active' ||
          latest.status === 'paused' ||
          event.state !== 'start' ||
          (latest.endedAt &&
            event.eventAt.getTime() <= latest.endedAt.getTime() &&
            latest.endedAt.getTime() - event.eventAt.getTime() <= OUT_OF_ORDER_MERGE_MS));
      session = canReuse ? latest : null;
    }

    if (!session) {
      const externalSessionId =
        event.externalSessionId ??
        `fallback:${hashWebhookValue(`${event.playbackKey}:${event.eventAt.toISOString()}`).slice(0, 48)}`;
      session = repository.create({
        householdId: integration.householdId,
        integrationId: integration.id,
        provider: event.provider,
        connectorKey: event.provider,
        serverId: event.serverId,
        externalSessionId,
        playbackKey: event.playbackKey,
        mediaLibraryItemId: libraryItem.id,
        mediaTitleId: libraryItem.mediaTitleId,
        libraryItemId: event.libraryItemId,
        contentItemId: event.contentItemId,
        mediaType: event.mediaType,
        title: event.title,
        deviceName: event.deviceName,
        status: eventStatus(event),
        positionMs: event.positionMs,
        durationMs: event.durationMs,
        startedAt: event.eventAt,
        endedAt: event.state === 'stop' || event.state === 'completed' ? event.eventAt : null,
        lastEventAt: event.eventAt,
      });
      return repository.save(session);
    }

    if (event.eventAt < session.startedAt) session.startedAt = event.eventAt;
    if (event.eventAt >= session.lastEventAt) {
      session.status = eventStatus(event);
      session.positionMs = event.positionMs;
      session.durationMs = event.durationMs ?? session.durationMs;
      session.title = event.title;
      session.deviceName = event.deviceName ?? session.deviceName;
      session.lastEventAt = event.eventAt;
      session.endedAt =
        event.state === 'stop' || event.state === 'completed' ? event.eventAt : null;
    }
    session.mediaLibraryItemId = libraryItem.id;
    session.mediaTitleId = libraryItem.mediaTitleId;
    return repository.save(session);
  }

  private async mergeParticipant(
    manager: EntityManager,
    session: ViewingSession,
    mapping: MediaUserMapping,
    event: NormalizedPlaybackEvent,
  ) {
    const repository = manager.getRepository(ViewingParticipant);
    const participant =
      (await repository.findOneBy({ sessionId: session.id, memberId: mapping.memberId })) ??
      repository.create({
        sessionId: session.id,
        memberId: mapping.memberId,
        memberName: mapping.member.name,
        externalUserId: mapping.externalUserId,
        externalUserName: mapping.externalUserName,
        joinedAt: event.eventAt,
        lastSeenAt: event.eventAt,
        finalPositionMs: event.positionMs,
      });
    if (event.eventAt < participant.joinedAt) participant.joinedAt = event.eventAt;
    if (event.eventAt >= participant.lastSeenAt) {
      participant.lastSeenAt = event.eventAt;
      participant.finalPositionMs = event.positionMs;
    }
    participant.memberName = mapping.member.name;
    participant.externalUserName = mapping.externalUserName;
    await repository.save(participant);
  }

  private async mergeProgress(
    manager: EntityManager,
    session: ViewingSession,
    mapping: MediaUserMapping,
    event: NormalizedPlaybackEvent,
    libraryItem: MediaLibraryItem,
  ) {
    const repository = manager.getRepository(ViewingProgress);
    const progress =
      (await repository.findOneBy({
        householdId: session.householdId,
        memberId: mapping.memberId,
        connectorKey: event.provider,
        contentItemId: event.contentItemId,
      })) ??
      repository.create({
        householdId: session.householdId,
        memberId: mapping.memberId,
        provider: event.provider,
        connectorKey: event.provider,
        contentItemId: event.contentItemId,
        title: event.title,
        positionMs: 0,
        durationMs: null,
        percentage: 0,
        completed: false,
        lastWatchedAt: event.eventAt,
      });
    if (event.eventAt >= progress.lastWatchedAt) {
      progress.mediaLibraryItemId = libraryItem.id;
      progress.mediaTitleId = libraryItem.mediaTitleId;
      progress.lastViewingSessionId = session.id;
      progress.title = event.title;
      progress.positionMs = event.positionMs;
      progress.durationMs = event.durationMs ?? progress.durationMs;
      progress.percentage = percentage(progress.positionMs, progress.durationMs);
      progress.completed = eventStatus(event) === 'completed';
      progress.lastWatchedAt = event.eventAt;
    }
    await repository.save(progress);
  }
}
