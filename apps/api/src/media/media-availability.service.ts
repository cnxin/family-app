import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMedia, MediaRequest } from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { MediaLibraryService } from './media-library.service';

/** 片单条目在家里媒体库里有没有：实时问连接器 + 媒体库快照，合并去重；连接器状态（J7.2 从 MediaService 拆出）。 */
@Injectable()
export class MediaAvailabilityService {
  constructor(
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
    @InjectRepository(MediaRequest)
    private readonly mediaRequests: Repository<MediaRequest>,
    private readonly connectors: MediaConnectorsService,
    private readonly library: MediaLibraryService,
  ) {}

  connectorStatus(user: JwtUser, refresh = false) {
    return this.connectors.status(user.householdId, refresh);
  }

  async libraryAvailability(mediaIds: string[], user: JwtUser) {
    if (!mediaIds.length) return {};
    const entries = await this.householdMedia.find({
      where: mediaIds.map((id) => ({ id, householdId: user.householdId })),
      relations: { mediaTitle: { externalRefs: true } },
    });
    const requests = await this.mediaRequests.find({
      where: {
        householdId: user.householdId,
        householdMediaId: In(entries.map((entry) => entry.id)),
      },
      order: { updatedAt: 'DESC' },
    });
    const requestedSeasonsByMedia = new Map<string, number[]>();
    for (const request of requests) {
      if (requestedSeasonsByMedia.has(request.householdMediaId)) continue;
      if (!request.season || request.status === 'cancelled') {
        requestedSeasonsByMedia.set(request.householdMediaId, []);
        continue;
      }
      const seasons = requestedSeasonsByMedia.get(request.householdMediaId) ?? [];
      seasons.push(request.season);
      requestedSeasonsByMedia.set(request.householdMediaId, seasons);
    }
    const media = entries.map((entry) => ({
      id: entry.id,
      mediaTitleId: entry.mediaTitleId,
      requestedSeasons: requestedSeasonsByMedia.get(entry.id) ?? [],
      externalRefs: (entry.mediaTitle.externalRefs ?? []).map((ref) => ({
        provider: ref.provider,
        mediaType: ref.mediaType,
        externalId: ref.externalId,
        connectorKey: ref.connectorKey ?? undefined,
      })),
    }));
    const [live, snapshots] = await Promise.all([
      this.connectors.availability(
      user.householdId,
      media.map((entry) => ({
        id: entry.id,
        externalRefs: entry.externalRefs,
        requestedSeasons: entry.requestedSeasons,
      })),
      ),
      this.library.availability(user.householdId, media),
    ]);
    for (const entry of media) {
      const keys = new Set(
        live[entry.id].map(
          (match) => `${match.connectorKey}:${match.libraryItemId}`,
        ),
      );
      live[entry.id].push(
        ...snapshots[entry.id].filter(
          (match) => !keys.has(`${match.connectorKey}:${match.libraryItemId}`),
        ),
      );
    }
    return live;
  }
}
