import { EntityManager } from 'typeorm';
import {
  Integration,
  MediaLibraryItem,
  MediaUserMapping,
  ViewingParticipant,
  ViewingProgress,
  ViewingSession,
} from '../entities';
import { hashWebhookValue } from './moviepilot-webhook.service';
import { NormalizedPlaybackEvent, eventStatus, percentage } from './playback-webhook.normalize';

const OUT_OF_ORDER_MERGE_MS = 5 * 60 * 1000;

export async function mergeSession(
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

export async function mergeParticipant(
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

export async function mergeProgress(
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
