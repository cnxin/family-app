import { BadRequestException } from '@nestjs/common';
import { MediaLibraryProviderKind, MediaType, ViewingSessionStatus } from '../entities';
import { hashWebhookValue } from './moviepilot-webhook.service';

const MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const MAX_EVENT_FUTURE_MS = 10 * 60 * 1000;

type JsonObject = Record<string, unknown>;

type PlaybackEventState = 'start' | 'progress' | 'pause' | 'stop' | 'completed';

export interface NormalizedPlaybackEvent {
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

export function text(value: unknown, maxLength: number) {
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

export function eventStatus(event: NormalizedPlaybackEvent): ViewingSessionStatus {
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

export function percentage(positionMs: number, durationMs: number | null) {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.max(0, Math.min(100, (positionMs / durationMs) * 100));
}

export function parsePlexPayload(body: unknown) {
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

export function normalize(
  provider: MediaLibraryProviderKind,
  body: unknown,
  receivedAt: Date,
) {
  return provider === 'plex'
    ? normalizePlex(body, receivedAt)
    : normalizeEmby(body, receivedAt);
}

export function auditSnapshot(event: NormalizedPlaybackEvent) {
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
