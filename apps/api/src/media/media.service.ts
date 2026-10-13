import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaExternalRef,
  MediaRequest,
  MediaTitle,
  MediaType,
  Poll,
  PollOption,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { MediaLibraryService } from './media-library.service';
import { isUniqueViolation } from '@family/shared';
import {
  MediaQueryDto,
  MediaExternalRefDto,
  CreateMediaDto,
  UpdateMediaDto,
  AddMediaExternalRefsDto,
} from './media.dto';

const STATUS_LABELS: Record<HouseholdMediaStatus, string> = {
  watchlist: '想看',
  voting: '投票中',
  scheduled: '已排期',
  watching: '观看中',
  completed: '已看完',
  dropped: '不再观看',
};

const STATUS_TRANSITIONS: Record<
  HouseholdMediaStatus,
  HouseholdMediaStatus[]
> = {
  watchlist: ['voting', 'scheduled', 'watching', 'completed', 'dropped'],
  voting: ['watchlist', 'scheduled', 'dropped'],
  scheduled: ['watchlist', 'watching', 'completed', 'dropped'],
  watching: ['completed', 'dropped', 'watchlist'],
  completed: ['watchlist', 'watching'],
  dropped: ['watchlist'],
};

export function normalizeText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function titleDedupeKey(type: MediaType, title: string, year: number | null) {
  return `${type}:${year ?? 'unknown'}:${normalizeText(title).toLocaleLowerCase(
    'zh-CN',
  )}`;
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('观影日期不是有效的 YYYY-MM-DD 日期');
  }
  return value;
}

function normalizeExternalRefs(refs: MediaExternalRefDto[] = []) {
  const normalized = refs.map((ref) => ({
    provider: ref.provider,
    externalId:
      ref.provider === 'imdb'
        ? normalizeText(ref.externalId).toLocaleLowerCase('en-US')
        : normalizeText(ref.externalId),
  }));
  if (normalized.some((ref) => !ref.externalId)) {
    throw new BadRequestException('外部编号不能为空');
  }
  const keys = normalized.map(
    (ref) => `${ref.provider}:${ref.externalId.toLocaleLowerCase('en-US')}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('外部编号不能重复');
  }
  return normalized;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
    @InjectRepository(MediaRequest)
    private readonly mediaRequests: Repository<MediaRequest>,
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
    private readonly library: MediaLibraryService,
  ) {}

  async list(query: MediaQueryDto, user: JwtUser) {
    const builder = this.householdMedia
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.mediaTitle', 'title')
      .leftJoinAndSelect('title.externalRefs', 'externalRef')
      .innerJoinAndSelect('entry.createdBy', 'createdBy')
      .where('entry.householdId = :householdId', {
        householdId: user.householdId,
      })
      .orderBy('entry.updatedAt', 'DESC')
      .addOrderBy('externalRef.provider', 'ASC')
      .take(100);

    if (query.status && query.status !== 'all') {
      builder.andWhere('entry.status = :status', { status: query.status });
    }
    const search = query.search?.trim();
    if (search) {
      builder.andWhere(
        '(title.title ILIKE :search OR title.originalTitle ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    return (await builder.getMany()).map((entry) => this.present(entry));
  }

  async get(id: string, user: JwtUser, manager?: EntityManager) {
    const repository = (manager ?? this.dataSource.manager).getRepository(
      HouseholdMedia,
    );
    const entry = await repository.findOne({
      where: { id, householdId: user.householdId },
      relations: { mediaTitle: { externalRefs: true }, createdBy: true },
    });
    if (!entry) throw new NotFoundException('观影片单不存在');
    return this.present(entry);
  }

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

  async create(dto: CreateMediaDto, user: JwtUser) {
    const title = normalizeText(dto.title);
    if (!title) throw new BadRequestException('影视名称不能为空');
    const year = dto.year ?? null;
    const dedupeKey = titleDedupeKey(dto.type, title, year);
    const externalRefs = normalizeExternalRefs(dto.externalRefs);
    const status = dto.status ?? 'watchlist';
    const scheduledFor = parseDateOnly(dto.scheduledFor);
    if (status === 'scheduled' && !scheduledFor) {
      throw new BadRequestException('已排期状态必须选择观影日期');
    }

    const entryId = await this.dataSource.transaction(async (manager) => {
      const lockKeys = [
        `title:${dedupeKey}`,
        ...externalRefs.map(
          (ref) =>
            ref.provider === 'tmdb'
              ? `external:${ref.provider}:${dto.type}:${ref.externalId}`
              : `external:${ref.provider}:${ref.externalId}`,
        ),
      ].sort();
      for (const lockKey of lockKeys) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [lockKey],
        );
      }

      const mediaTitles = manager.getRepository(MediaTitle);
      const refs = manager.getRepository(MediaExternalRef);
      const existingRefs = externalRefs.length
        ? await refs.find({
            where: externalRefs.map((ref) =>
              ref.provider === 'tmdb'
                ? {
                    provider: ref.provider,
                    mediaType: dto.type,
                    externalId: ref.externalId,
                  }
                : {
                    provider: ref.provider,
                    externalId: ref.externalId,
                  },
            ),
          })
        : [];
      const referencedTitleIds = new Set(
        existingRefs.map((ref) => ref.mediaTitleId),
      );
      if (referencedTitleIds.size > 1) {
        throw new ConflictException('提供的外部编号指向不同影视条目');
      }

      let mediaTitle = referencedTitleIds.size
        ? await mediaTitles.findOneByOrFail({
            id: [...referencedTitleIds][0],
          })
        : await mediaTitles.findOneBy({ dedupeKey });
      if (mediaTitle && mediaTitle.type !== dto.type) {
        throw new ConflictException('外部编号对应的影视类型不一致');
      }
      if (!mediaTitle) {
        mediaTitle = await mediaTitles.save(
          mediaTitles.create({
            type: dto.type,
            title,
            originalTitle: dto.originalTitle
              ? normalizeText(dto.originalTitle) || null
              : null,
            year,
            overview: dto.overview?.trim() || null,
            posterUrl: dto.posterUrl?.trim() || null,
            dedupeKey,
            metadata: {},
          }),
        );
      }

      const existingRefKeys = new Set(
        existingRefs.map(
          (ref) => `${ref.provider}:${ref.externalId.toLocaleLowerCase('en-US')}`,
        ),
      );
      const missingRefs = externalRefs.filter(
        (ref) =>
          !existingRefKeys.has(
            `${ref.provider}:${ref.externalId.toLocaleLowerCase('en-US')}`,
          ),
      );
      if (missingRefs.length) {
        await refs.save(
          missingRefs.map((ref) =>
            refs.create({
              mediaTitleId: mediaTitle.id,
              mediaType: dto.type,
              provider: ref.provider,
              externalId: ref.externalId,
              connectorKey: null,
              metadata: {},
            }),
          ),
        );
      }

      const entries = manager.getRepository(HouseholdMedia);
      const existingEntry = await entries.findOneBy({
        householdId: user.householdId,
        mediaTitleId: mediaTitle.id,
      });
      if (existingEntry) {
        throw new ConflictException('这部影视已经在家庭片单中');
      }
      const entry = await entries.save(
        entries.create({
          householdId: user.householdId,
          mediaTitleId: mediaTitle.id,
          status,
          scheduledFor,
          note: dto.note?.trim() || null,
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_added',
        summary: `${user.name} 将「${mediaTitle.title}」加入家庭片单`,
        targetPath: `/media?mediaId=${entry.id}`,
        metadata: {
          mediaId: entry.id,
          mediaTitleId: mediaTitle.id,
          status,
        },
      });
      if (scheduledFor) {
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_scheduled',
          summary: `${user.name} 将「${mediaTitle.title}」安排在 ${scheduledFor} 观看`,
          targetPath: `/media?mediaId=${entry.id}`,
          metadata: { mediaId: entry.id, scheduledFor },
        });
      }
      return entry.id;
    });
    return this.get(entryId, user);
  }

  async update(id: string, dto: UpdateMediaDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`poll-source:${user.householdId}:media:${id}`],
      );
      const entry = await manager
        .getRepository(HouseholdMedia)
        .createQueryBuilder('entry')
        .innerJoinAndSelect('entry.mediaTitle', 'title')
        .where('entry.id = :id AND entry.householdId = :householdId', {
          id,
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!entry) throw new NotFoundException('观影片单不存在');

      const oldStatus = entry.status;
      const oldScheduledFor = entry.scheduledFor;
      const nextStatus = dto.status ?? oldStatus;
      if (
        nextStatus !== oldStatus &&
        !STATUS_TRANSITIONS[oldStatus].includes(nextStatus)
      ) {
        throw new ConflictException(
          `不能从“${STATUS_LABELS[oldStatus]}”直接改为“${STATUS_LABELS[nextStatus]}”`,
        );
      }
      if (
        oldStatus === 'voting' &&
        nextStatus !== 'voting' &&
        (await this.hasActivePoll(manager, entry.id, user.householdId))
      ) {
        throw new ConflictException('请先结束这部影视的家庭投票，再修改观影状态');
      }

      if (Object.prototype.hasOwnProperty.call(dto, 'scheduledFor')) {
        entry.scheduledFor = parseDateOnly(dto.scheduledFor);
      } else if (
        nextStatus !== oldStatus &&
        ['watchlist', 'voting', 'dropped'].includes(nextStatus)
      ) {
        entry.scheduledFor = null;
      }
      if (nextStatus === 'scheduled' && !entry.scheduledFor) {
        throw new BadRequestException('已排期状态必须选择观影日期');
      }
      entry.status = nextStatus;
      if (Object.prototype.hasOwnProperty.call(dto, 'note')) {
        entry.note = dto.note?.trim() || null;
      }
      await manager.getRepository(HouseholdMedia).save(entry);

      if (entry.status !== oldStatus) {
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_status_changed',
          summary: `${user.name} 将「${entry.mediaTitle.title}」设为${STATUS_LABELS[entry.status]}`,
          targetPath: `/media?mediaId=${entry.id}`,
          metadata: {
            mediaId: entry.id,
            fromStatus: oldStatus,
            toStatus: entry.status,
          },
        });
      }
      if (entry.scheduledFor !== oldScheduledFor) {
        await recordActivity(manager, user, {
          module: 'media',
          action: entry.scheduledFor
            ? 'media_scheduled'
            : 'media_schedule_cleared',
          summary: entry.scheduledFor
            ? `${user.name} 将「${entry.mediaTitle.title}」安排在 ${entry.scheduledFor} 观看`
            : `${user.name} 取消了「${entry.mediaTitle.title}」的观影日期`,
          targetPath: `/media?mediaId=${entry.id}`,
          metadata: {
            mediaId: entry.id,
            scheduledFor: entry.scheduledFor,
          },
        });
      }
    });
    return this.get(id, user);
  }

  async addExternalRefs(
    id: string,
    dto: AddMediaExternalRefsDto,
    user: JwtUser,
  ) {
    const externalRefs = normalizeExternalRefs(dto.externalRefs);
    if (
      externalRefs.some(
        (reference) =>
          reference.provider === 'tmdb' && !/^\d+$/.test(reference.externalId),
      )
    ) {
      throw new BadRequestException('TMDB ID 只能填写数字');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        const entries = manager.getRepository(HouseholdMedia);
        const entry = await entries
          .createQueryBuilder('entry')
          .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
          .where('entry.id = :id AND entry.householdId = :householdId', {
            id,
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!entry) throw new NotFoundException('观影片单不存在');

        const lockKeys = [
          `media-metadata:${entry.mediaTitleId}`,
          ...externalRefs.map((reference) =>
            reference.provider === 'tmdb'
              ? `external:${reference.provider}:${entry.mediaTitle.type}:${reference.externalId}`
              : `external:${reference.provider}:${reference.externalId}`,
          ),
        ].sort();
        for (const lockKey of lockKeys) {
          await manager.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [lockKey],
          );
        }

        const titles = manager.getRepository(MediaTitle);
        const mediaTitle = await titles.findOne({
          where: { id: entry.mediaTitleId },
          relations: { externalRefs: true },
        });
        if (!mediaTitle) throw new NotFoundException('影视资料不存在');

        const existingByProvider = new Map(
          (mediaTitle.externalRefs ?? [])
            .filter((reference) => reference.connectorKey == null)
            .map((reference) => [reference.provider, reference]),
        );
        const refs = manager.getRepository(MediaExternalRef);
        const additions: typeof externalRefs = [];
        for (const reference of externalRefs) {
          const current = existingByProvider.get(reference.provider);
          if (current) {
            if (current.externalId !== reference.externalId) {
              throw new ConflictException(
                `这部影视已经关联其他 ${reference.provider.toUpperCase()} 编号`,
              );
            }
            continue;
          }

          const owner = await refs.findOne({
            where:
              reference.provider === 'tmdb'
                ? {
                    provider: reference.provider,
                    mediaType: mediaTitle.type,
                    externalId: reference.externalId,
                  }
                : {
                    provider: reference.provider,
                    externalId: reference.externalId,
                  },
          });
          if (owner && owner.mediaTitleId !== mediaTitle.id) {
            throw new ConflictException('这个外部编号已经关联到其他影视条目');
          }
          if (!owner) additions.push(reference);
        }

        if (!additions.length) return;
        await refs.save(
          additions.map((reference) =>
            refs.create({
              mediaTitleId: mediaTitle.id,
              mediaType: mediaTitle.type,
              provider: reference.provider,
              externalId: reference.externalId,
              connectorKey: null,
              metadata: {},
            }),
          ),
        );
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_metadata_linked',
          summary: `${user.name} 补充了「${mediaTitle.title}」的影视编号`,
          targetPath: `/media?mediaId=${entry.id}&view=detail`,
          metadata: {
            mediaId: entry.id,
            mediaTitleId: mediaTitle.id,
            providers: additions.map((reference) => reference.provider),
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个外部编号已经关联到其他影视条目');
      }
      throw error;
    }
    return this.get(id, user);
  }

  async remove(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`poll-source:${user.householdId}:media:${id}`],
      );
      const entry = await manager
        .getRepository(HouseholdMedia)
        .createQueryBuilder('entry')
        .innerJoinAndSelect('entry.mediaTitle', 'title')
        .where('entry.id = :id AND entry.householdId = :householdId', {
          id,
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!entry) throw new NotFoundException('观影片单不存在');
      if (await this.hasActivePoll(manager, entry.id, user.householdId)) {
        throw new ConflictException('请先结束或删除这部影视的家庭投票，再移出片单');
      }
      if (await this.hasMediaPollReference(manager, entry.id)) {
        throw new ConflictException('请先删除包含这部影视的历史选片投票，再移出片单');
      }
      if (await this.hasActiveRequest(manager, entry.id, user.householdId)) {
        throw new ConflictException('请先取消这部影视进行中的 MoviePilot 订阅，再移出片单');
      }
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_removed',
        summary: `${user.name} 从家庭片单移除了「${entry.mediaTitle.title}」`,
        metadata: {
          mediaId: entry.id,
          mediaTitleId: entry.mediaTitleId,
          status: entry.status,
        },
      });
      await manager.getRepository(HouseholdMedia).remove(entry);
    });
    return { id, removed: true as const };
  }

  private present(entry: HouseholdMedia) {
    return {
      id: entry.id,
      householdId: entry.householdId,
      status: entry.status,
      scheduledFor: entry.scheduledFor,
      note: entry.note,
      mediaTitle: {
        id: entry.mediaTitle.id,
        type: entry.mediaTitle.type,
        title: entry.mediaTitle.title,
        originalTitle: entry.mediaTitle.originalTitle,
        year: entry.mediaTitle.year,
        overview: entry.mediaTitle.overview,
        posterUrl: entry.mediaTitle.posterUrl,
        externalRefs: (entry.mediaTitle.externalRefs ?? [])
          .map((ref) => ({
            id: ref.id,
            provider: ref.provider,
            externalId: ref.externalId,
            connectorKey: ref.connectorKey,
          }))
          .sort((left, right) => left.provider.localeCompare(right.provider)),
      },
      createdBy: {
        id: entry.createdBy.id,
        name: entry.createdBy.name,
        avatarEmoji: entry.createdBy.avatarEmoji,
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private async hasActivePoll(
    manager: EntityManager,
    mediaId: string,
    householdId: string,
  ) {
    const polls = await manager
      .getRepository(Poll)
      .createQueryBuilder('poll')
      .leftJoin('poll.options', 'option')
      .where('poll.householdId = :householdId', { householdId })
      .andWhere('poll.status = :status', { status: 'open' })
      .andWhere('poll.isArchived = false')
      .andWhere(
        `((poll."sourceModule" = 'media' AND poll."sourceId" = :mediaId) OR option."mediaId" = :mediaId)`,
        { mediaId },
      )
      .distinct(true)
      .getMany();
    return polls.some(
      (poll) => !poll.closesAt || poll.closesAt.getTime() > Date.now(),
    );
  }

  private async hasActiveRequest(
    manager: EntityManager,
    mediaId: string,
    householdId: string,
  ) {
    return manager.getRepository(MediaRequest).exists({
      where: [
        { householdId, householdMediaId: mediaId, status: 'pending' },
        { householdId, householdMediaId: mediaId, status: 'processing' },
      ],
    });
  }

  private async hasMediaPollReference(
    manager: EntityManager,
    mediaId: string,
  ) {
    return manager.getRepository(PollOption).existsBy({ mediaId });
  }
}
