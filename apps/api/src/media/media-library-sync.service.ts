import { BadGatewayException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  HouseholdMedia,
  Integration,
  MediaExternalRef,
  MediaLibraryItem,
  MediaType,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { errorMessage } from './media-library.service';
import { titleDedupeKey } from './media-rules';

function metadataRefKey(
  provider: 'tmdb' | 'imdb',
  mediaType: MediaType,
  externalId: string,
) {
  return provider === 'tmdb'
    ? `${provider}:${mediaType}:${externalId.toLocaleLowerCase('en-US')}`
    : `${provider}:${externalId.toLocaleLowerCase('en-US')}`;
}

/** 媒体库同步：从 Plex / Emby 拉片库目录写进 media_library_items，并把能对上的条目挂到影视资料上（J7.2 从 MediaLibraryService 拆出）。 */
@Injectable()
export class MediaLibrarySyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  async sync(connectorKey: string | undefined, user: JwtUser) {
    let scans;
    try {
      scans = await this.connectors.scanLibraries(user.householdId, connectorKey);
    } catch (error) {
      throw new BadGatewayException(`媒体库同步失败：${errorMessage(error)}`);
    }
    const results: {
      connectorKey: string;
      name: string;
      provider: 'plex' | 'emby';
      itemCount: number;
      matchedCount: number;
      syncedAt: Date;
    }[] = [];
    for (const scan of scans) {
      const syncedAt = new Date();
      const matched = await this.dataSource.transaction(async (manager) => {
        const householdEntries = await manager.getRepository(HouseholdMedia).find({
          where: { householdId: user.householdId },
          relations: { mediaTitle: { externalRefs: true } },
        });
        const titleByDedupe = new Map<string, string>();
        const titleByRef = new Map<string, string>();
        const titleByConnectorRef = new Map<string, string>();
        for (const entry of householdEntries) {
          titleByDedupe.set(entry.mediaTitle.dedupeKey, entry.mediaTitleId);
          for (const ref of entry.mediaTitle.externalRefs ?? []) {
            if (ref.provider === 'tmdb' || ref.provider === 'imdb') {
              titleByRef.set(
                metadataRefKey(ref.provider, ref.mediaType, ref.externalId),
                entry.mediaTitleId,
              );
            } else if (
              ref.provider === scan.provider &&
              ref.connectorKey === scan.connectorKey
            ) {
              titleByConnectorRef.set(ref.externalId, entry.mediaTitleId);
            }
          }
        }
        const previous = await manager.getRepository(MediaLibraryItem).find({
          where: {
            householdId: user.householdId,
            connectorKey: scan.connectorKey,
          },
        });
        const previousTitleByItem = new Map(
          previous
            .filter((item) => item.mediaTitleId)
            .map((item) => [item.libraryItemId, item.mediaTitleId!]),
        );
        const records = scan.items.map((item) => {
          const byRef = item.externalRefs
            .filter(
              (ref): ref is typeof ref & { provider: 'tmdb' | 'imdb' } =>
                ref.provider === 'tmdb' || ref.provider === 'imdb',
            )
            .map((ref) =>
              titleByRef.get(metadataRefKey(ref.provider, ref.mediaType, ref.externalId)),
            )
            .find((id): id is string => Boolean(id));
          const mediaTitleId =
            titleByConnectorRef.get(item.libraryItemId) ??
            byRef ??
            titleByDedupe.get(titleDedupeKey(item.type, item.title, item.year)) ??
            (item.originalTitle
              ? titleByDedupe.get(
                  titleDedupeKey(item.type, item.originalTitle, item.year),
                )
              : undefined) ??
            previousTitleByItem.get(item.libraryItemId) ??
            null;
          return manager.getRepository(MediaLibraryItem).create({
            householdId: user.householdId,
            mediaTitleId,
            provider: scan.provider,
            connectorKey: scan.connectorKey,
            libraryItemId: item.libraryItemId,
            mediaType: item.type,
            title: item.title.slice(0, 180),
            originalTitle: item.originalTitle?.slice(0, 180) ?? null,
            year: item.year,
            overview: item.overview?.slice(0, 5000) ?? null,
            posterUrl: item.posterUrl?.slice(0, 2000) ?? null,
            externalRefs: item.externalRefs
              .filter(
                (ref): ref is typeof ref & { provider: 'tmdb' | 'imdb' } =>
                  ref.provider === 'tmdb' || ref.provider === 'imdb',
              )
              .map((ref) => ({
                provider: ref.provider,
                mediaType: ref.mediaType,
                externalId: ref.externalId,
              })),
            playbackUrl: item.playbackUrl?.slice(0, 4000) ?? null,
            metadata: item.metadata,
            lastSeenAt: syncedAt,
          });
        });
        const repository = manager.getRepository(MediaLibraryItem);
        for (let index = 0; index < records.length; index += 200) {
          await repository.upsert(records.slice(index, index + 200), {
            conflictPaths: ['householdId', 'connectorKey', 'libraryItemId'],
          });
        }
        await repository
          .createQueryBuilder()
          .delete()
          .where('householdId = :householdId', { householdId: user.householdId })
          .andWhere('connectorKey = :connectorKey', {
            connectorKey: scan.connectorKey,
          })
          .andWhere('lastSeenAt < :syncedAt', { syncedAt })
          .execute();
        const matchedRecords = records.filter((record) => record.mediaTitleId);
        const refs = manager.getRepository(MediaExternalRef);
        for (const record of matchedRecords) {
          const values = [
            ...record.externalRefs.map((ref) => ({
              mediaTitleId: record.mediaTitleId!,
              mediaType: ref.mediaType,
              provider: ref.provider,
              externalId: ref.externalId,
              connectorKey: null,
              metadata: {},
            })),
            {
              mediaTitleId: record.mediaTitleId!,
              mediaType: record.mediaType,
              provider: record.provider,
              externalId: record.libraryItemId,
              connectorKey: record.connectorKey,
              metadata: {},
            },
          ];
          await refs.createQueryBuilder().insert().values(values).orIgnore().execute();
        }
        await manager.getRepository(Integration).update(
          { householdId: user.householdId, kind: scan.provider },
          { lastSyncedAt: syncedAt },
        );
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_library_synced',
          summary: `${user.name} 同步了 ${scan.name}，共 ${records.length} 部影视`,
          targetPath: '/media/library',
          metadata: {
            connectorKey: scan.connectorKey,
            itemCount: records.length,
            matchedCount: matchedRecords.length,
          },
        });
        return matchedRecords.length;
      });
      results.push({
        connectorKey: scan.connectorKey,
        name: scan.name,
        provider: scan.provider,
        itemCount: scan.items.length,
        matchedCount: matched,
        syncedAt,
      });
    }
    this.connectors.clearHouseholdCache(user.householdId);
    return { results };
  }
}
