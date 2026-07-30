import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { jwtSecret } from '../common/config';
import {
  HouseholdMedia,
  Integration,
  MediaExternalRef,
  MediaLibraryItem,
  MediaTitle,
  MediaType,
} from '../entities';
import {
  MediaConnectorsService,
  PublicLibraryMatch,
} from './media-connectors.service';

export interface MediaLibraryQuery {
  connectorKey?: string;
  type?: MediaType;
  search?: string;
  page?: number;
  pageSize?: number;
}

const POSTER_URL_TTL_SECONDS = 24 * 60 * 60;

function hasConnectorPoster(item: MediaLibraryItem) {
  if (item.provider === 'plex') {
    return (
      typeof item.metadata.thumb === 'string' &&
      item.metadata.thumb.startsWith('/')
    );
  }
  const imageTags = item.metadata.imageTags;
  return Boolean(
    imageTags &&
      typeof imageTags === 'object' &&
      !Array.isArray(imageTags) &&
      typeof (imageTags as Record<string, unknown>).Primary === 'string',
  );
}

function normalizeText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function titleDedupeKey(type: MediaType, title: string, year: number | null) {
  return `${type}:${year ?? 'unknown'}:${normalizeText(title).toLocaleLowerCase(
    'zh-CN',
  )}`;
}

function metadataRefKey(
  provider: 'tmdb' | 'imdb',
  mediaType: MediaType,
  externalId: string,
) {
  return provider === 'tmdb'
    ? `${provider}:${mediaType}:${externalId.toLocaleLowerCase('en-US')}`
    : `${provider}:${externalId.toLocaleLowerCase('en-US')}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 1000)
    : '媒体库同步失败';
}

@Injectable()
export class MediaLibraryService {
  private readonly posterSigningSecret = jwtSecret();

  constructor(
    @InjectRepository(MediaLibraryItem)
    private readonly libraryItems: Repository<MediaLibraryItem>,
    @InjectRepository(Integration)
    private readonly integrations: Repository<Integration>,
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  async list(query: MediaLibraryQuery, user: JwtUser) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(60, Math.max(12, query.pageSize ?? 24));
    const builder = this.libraryItems
      .createQueryBuilder('item')
      .where('item.householdId = :householdId', {
        householdId: user.householdId,
      })
      .orderBy('item.title', 'ASC')
      .addOrderBy('item.year', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (query.connectorKey) {
      builder.andWhere('item.connectorKey = :connectorKey', {
        connectorKey: query.connectorKey,
      });
    }
    if (query.type) builder.andWhere('item.mediaType = :type', { type: query.type });
    if (query.search?.trim()) {
      builder.andWhere(
        '(item.title ILIKE :search OR item.originalTitle ILIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }
    const [items, total] = await builder.getManyAndCount();
    const mediaTitleIds = items
      .map((item) => item.mediaTitleId)
      .filter((id): id is string => Boolean(id));
    const entries = mediaTitleIds.length
      ? await this.householdMedia.find({
          where: {
            householdId: user.householdId,
            mediaTitleId: In(mediaTitleIds),
          },
        })
      : [];
    const entryByTitle = new Map(
      entries.map((entry) => [entry.mediaTitleId, entry.id]),
    );
    const connectorNames = await this.connectorNames(user.householdId);
    const syncState = await this.syncState(user.householdId);
    return {
      items: items.map((item) => this.present(item, connectorNames, entryByTitle)),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      lastSyncedAt:
        syncState
          .map((state) => state.lastSyncedAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      connectors: syncState.map((state) => ({
        connectorKey: state.kind,
        name: state.name,
        provider: state.kind,
        lastSyncedAt: state.lastSyncedAt,
      })),
    };
  }

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

  async poster(itemId: string, expires: number, signature: string) {
    this.verifyPosterSignature(itemId, expires, signature);
    const item = await this.libraryItems.findOne({ where: { id: itemId } });
    if (!item || !hasConnectorPoster(item)) {
      throw new NotFoundException('海报不存在');
    }
    try {
      const poster = await this.connectors.getLibraryPoster(
        item.householdId,
        item.connectorKey,
        item.libraryItemId,
        item.metadata,
      );
      if (!poster) throw new NotFoundException('海报不存在');
      return poster;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadGatewayException(`海报读取失败：${errorMessage(error)}`);
    }
  }

  async addToWatchlist(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(MediaLibraryItem).findOne({
        where: { id, householdId: user.householdId },
      });
      if (!item) throw new NotFoundException('媒体库条目不存在');
      const dedupeKey = titleDedupeKey(item.mediaType, item.title, item.year);
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`library-item:${user.householdId}:${item.connectorKey}:${item.libraryItemId}`],
      );
      const titles = manager.getRepository(MediaTitle);
      let mediaTitle = item.mediaTitleId
        ? await titles.findOneBy({ id: item.mediaTitleId })
        : null;
      if (!mediaTitle && item.externalRefs.length) {
        const refs = await manager.getRepository(MediaExternalRef).find({
          where: item.externalRefs.map((ref) =>
            ref.provider === 'tmdb'
              ? {
                  provider: ref.provider,
                  mediaType: ref.mediaType,
                  externalId: ref.externalId,
                }
              : { provider: ref.provider, externalId: ref.externalId },
          ),
        });
        const titleIds = [...new Set(refs.map((ref) => ref.mediaTitleId))];
        if (titleIds.length > 1) {
          throw new ConflictException('媒体库外部编号对应了不同影视条目');
        }
        if (titleIds.length) mediaTitle = await titles.findOneBy({ id: titleIds[0] });
      }
      mediaTitle ??= await titles.findOneBy({ dedupeKey });
      if (!mediaTitle) {
        mediaTitle = await titles.save(
          titles.create({
            type: item.mediaType,
            title: item.title,
            originalTitle: item.originalTitle,
            year: item.year,
            overview: item.overview,
            posterUrl: item.posterUrl,
            dedupeKey,
            metadata: { importedFrom: item.provider },
          }),
        );
      }
      const externalRefs = manager.getRepository(MediaExternalRef);
      await externalRefs
        .createQueryBuilder()
        .insert()
        .values([
          ...item.externalRefs.map((ref) => ({
            mediaTitleId: mediaTitle!.id,
            mediaType: ref.mediaType,
            provider: ref.provider,
            externalId: ref.externalId,
            connectorKey: null,
            metadata: {},
          })),
          {
            mediaTitleId: mediaTitle.id,
            mediaType: item.mediaType,
            provider: item.provider,
            externalId: item.libraryItemId,
            connectorKey: item.connectorKey,
            metadata: {},
          },
        ])
        .orIgnore()
        .execute();
      item.mediaTitleId = mediaTitle.id;
      await manager.getRepository(MediaLibraryItem).save(item);
      const entries = manager.getRepository(HouseholdMedia);
      const existing = await entries.findOneBy({
        householdId: user.householdId,
        mediaTitleId: mediaTitle.id,
      });
      if (existing) {
        return { householdMediaId: existing.id, added: false as const };
      }
      const entry = await entries.save(
        entries.create({
          householdId: user.householdId,
          mediaTitleId: mediaTitle.id,
          status: 'watchlist',
          scheduledFor: null,
          note: null,
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_added',
        summary: `${user.name} 从 ${item.provider === 'plex' ? 'Plex' : 'Emby'} 将「${mediaTitle.title}」加入家庭片单`,
        targetPath: `/media/watchlist?mediaId=${entry.id}`,
        metadata: {
          mediaId: entry.id,
          mediaTitleId: mediaTitle.id,
          libraryItemId: item.id,
          connectorKey: item.connectorKey,
        },
      });
      return { householdMediaId: entry.id, added: true as const };
    });
  }

  async availability(
    householdId: string,
    media: { id: string; mediaTitleId: string }[],
  ): Promise<Record<string, PublicLibraryMatch[]>> {
    const result = Object.fromEntries(media.map((entry) => [entry.id, []])) as Record<
      string,
      PublicLibraryMatch[]
    >;
    const titleIds = media.map((entry) => entry.mediaTitleId);
    if (!titleIds.length) return result;
    const items = await this.libraryItems.find({
      where: { householdId, mediaTitleId: In(titleIds) },
    });
    const mediaIdByTitle = new Map(
      media.map((entry) => [entry.mediaTitleId, entry.id]),
    );
    const names = await this.connectorNames(householdId);
    for (const item of items) {
      const mediaId = item.mediaTitleId
        ? mediaIdByTitle.get(item.mediaTitleId)
        : undefined;
      if (!mediaId) continue;
      result[mediaId].push({
        connectorKey: item.connectorKey,
        provider: item.provider,
        name: names.get(item.connectorKey) ?? (item.provider === 'plex' ? 'Plex' : 'Emby'),
        primary: false,
        libraryItemId: item.libraryItemId,
        playbackUrl: item.playbackUrl,
      });
    }
    return result;
  }

  private async connectorNames(householdId: string) {
    const rows = await this.integrations.find({ where: { householdId } });
    return new Map<string, string>(rows.map((row) => [row.kind, row.name]));
  }

  private syncState(householdId: string) {
    return this.integrations.find({
      where: [
        { householdId, kind: 'plex' },
        { householdId, kind: 'emby' },
      ],
      order: { name: 'ASC' },
    });
  }

  private present(
    item: MediaLibraryItem,
    connectorNames: Map<string, string>,
    entryByTitle: Map<string, string>,
  ) {
    return {
      id: item.id,
      connectorKey: item.connectorKey,
      provider: item.provider,
      connectorName:
        connectorNames.get(item.connectorKey) ??
        (item.provider === 'plex' ? 'Plex' : 'Emby'),
      libraryItemId: item.libraryItemId,
      type: item.mediaType,
      title: item.title,
      originalTitle: item.originalTitle,
      year: item.year,
      overview: item.overview,
      posterUrl: this.posterUrlForItem(item),
      externalRefs: item.externalRefs,
      playbackUrl: item.playbackUrl,
      householdMediaId: item.mediaTitleId
        ? entryByTitle.get(item.mediaTitleId) ?? null
        : null,
      lastSeenAt: item.lastSeenAt,
    };
  }

  posterUrlForItem(item: MediaLibraryItem) {
    return item.posterUrl ?? this.posterUrl(item);
  }

  private posterUrl(item: MediaLibraryItem) {
    if (!hasConnectorPoster(item)) return null;
    const expires = Math.floor(Date.now() / 1000) + POSTER_URL_TTL_SECONDS;
    const signature = this.signPoster(item.id, expires);
    return `/media/library/${item.id}/poster?expires=${expires}&signature=${signature}`;
  }

  private signPoster(itemId: string, expires: number) {
    return createHmac('sha256', this.posterSigningSecret)
      .update(`media-library-poster:${itemId}:${expires}`)
      .digest('base64url');
  }

  private verifyPosterSignature(
    itemId: string,
    expires: number,
    signature: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + POSTER_URL_TTL_SECONDS + 60
    ) {
      throw new ForbiddenException('海报链接已过期');
    }
    const expected = Buffer.from(this.signPoster(itemId, expires), 'utf8');
    const received = Buffer.from(signature, 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('海报链接无效');
    }
  }
}
