import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { ViewingProgress, ViewingSession } from '../entities';
import { MediaLibraryService } from './media-library.service';

function publicMember(
  participant: ViewingSession['participants'][number],
) {
  return participant.member
    ? {
        id: participant.member.id,
        name: participant.member.name,
        avatarEmoji: participant.member.avatarEmoji,
      }
    : {
        id: participant.memberId,
        name: participant.memberName,
        avatarEmoji: null,
      };
}

@Injectable()
export class ViewingHistoryService {
  constructor(
    @InjectRepository(ViewingSession)
    private readonly sessions: Repository<ViewingSession>,
    @InjectRepository(ViewingProgress)
    private readonly progress: Repository<ViewingProgress>,
    private readonly library: MediaLibraryService,
  ) {}

  async listSessions(user: JwtUser, limit = 50) {
    const sessions = await this.sessions.find({
      where: { householdId: user.householdId },
      relations: {
        integration: true,
        mediaLibraryItem: true,
        participants: { member: true },
      },
      order: { lastEventAt: 'DESC' },
      take: limit,
    });
    return sessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      connectorName:
        session.integration?.name ?? (session.provider === 'plex' ? 'Plex' : 'Emby'),
      mediaLibraryItemId: session.mediaLibraryItemId,
      mediaTitleId: session.mediaTitleId,
      libraryItemId: session.libraryItemId,
      contentItemId: session.contentItemId,
      mediaType: session.mediaType,
      title: session.title,
      deviceName: session.deviceName,
      status: session.status,
      positionMs: session.positionMs,
      durationMs: session.durationMs,
      percentage:
        session.durationMs && session.durationMs > 0
          ? Math.max(0, Math.min(100, (session.positionMs / session.durationMs) * 100))
          : 0,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      lastEventAt: session.lastEventAt,
      posterUrl: session.mediaLibraryItem
        ? this.library.posterUrlForItem(session.mediaLibraryItem)
        : null,
      playbackUrl: session.mediaLibraryItem?.playbackUrl ?? null,
      participants: session.participants.map((participant) => ({
        id: participant.id,
        member: publicMember(participant),
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
      })),
    }));
  }

  async listProgress(user: JwtUser, limit = 100) {
    const entries = await this.progress.find({
      where: { householdId: user.householdId },
      relations: { member: true, mediaLibraryItem: true },
      order: { lastWatchedAt: 'DESC' },
      take: limit,
    });
    return entries.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      mediaLibraryItemId: entry.mediaLibraryItemId,
      mediaTitleId: entry.mediaTitleId,
      contentItemId: entry.contentItemId,
      title: entry.title,
      positionMs: entry.positionMs,
      durationMs: entry.durationMs,
      percentage: entry.percentage,
      completed: entry.completed,
      lastWatchedAt: entry.lastWatchedAt,
      posterUrl: entry.mediaLibraryItem
        ? this.library.posterUrlForItem(entry.mediaLibraryItem)
        : null,
      playbackUrl: entry.mediaLibraryItem?.playbackUrl ?? null,
      member: {
        id: entry.member.id,
        name: entry.member.name,
        avatarEmoji: entry.member.avatarEmoji,
      },
    }));
  }
}
