import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMedia, MediaExternalRef, MediaTitle } from '../entities';
import { isUniqueViolation } from '@family/shared';
import { linkMediaExternalRefs } from './media-external-refs';
import {
  MediaQueryDto,
  CreateMediaDto,
  UpdateMediaDto,
  AddMediaExternalRefsDto,
} from './media.dto';
import {
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  normalizeText,
  titleDedupeKey,
  parseDateOnly,
  normalizeExternalRefs,
  present,
  hasActivePoll,
  hasActiveRequest,
  hasMediaPollReference,
} from './media-rules';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
    private readonly dataSource: DataSource,
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
    return (await builder.getMany()).map((entry) => present(entry));
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
    return present(entry);
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
        (await hasActivePoll(manager, entry.id, user.householdId))
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
      await this.dataSource.transaction((manager) =>
        linkMediaExternalRefs(manager, id, externalRefs, user),
      );
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
      if (await hasActivePoll(manager, entry.id, user.householdId)) {
        throw new ConflictException('请先结束或删除这部影视的家庭投票，再移出片单');
      }
      if (await hasMediaPollReference(manager, entry.id)) {
        throw new ConflictException('请先删除包含这部影视的历史选片投票，再移出片单');
      }
      if (await hasActiveRequest(manager, entry.id, user.householdId)) {
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
}
