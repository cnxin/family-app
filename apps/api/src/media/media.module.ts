import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaExternalProvider,
  MediaExternalRef,
  MediaTitle,
  MediaType,
  Poll,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';

const MEDIA_STATUSES: HouseholdMediaStatus[] = [
  'watchlist',
  'voting',
  'scheduled',
  'watching',
  'completed',
  'dropped',
];

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

class MediaQueryDto {
  @IsOptional()
  @IsIn(['all', ...MEDIA_STATUSES])
  status?: HouseholdMediaStatus | 'all';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

class MediaExternalRefDto {
  @IsIn(['tmdb', 'imdb'])
  provider: Extract<MediaExternalProvider, 'tmdb' | 'imdb'>;

  @IsString()
  @MaxLength(180)
  externalId: string;
}

class CreateMediaDto {
  @IsIn(['movie', 'series'])
  type: MediaType;

  @IsString()
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  originalTitle?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1878)
  @Max(2199)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  overview?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  posterUrl?: string | null;

  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: HouseholdMediaStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledFor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => MediaExternalRefDto)
  externalRefs?: MediaExternalRefDto[];
}

class UpdateMediaDto {
  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: HouseholdMediaStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledFor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class MediaAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  mediaIds: string[];
}

function normalizeText(value: string) {
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
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
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

  connectorStatus(refresh = false) {
    return this.connectors.status(refresh);
  }

  async libraryAvailability(mediaIds: string[], user: JwtUser) {
    if (!mediaIds.length) return {};
    const entries = await this.householdMedia.find({
      where: mediaIds.map((id) => ({ id, householdId: user.householdId })),
      relations: { mediaTitle: { externalRefs: true } },
    });
    return this.connectors.availability(
      entries.map((entry) => ({
        id: entry.id,
        externalRefs: (entry.mediaTitle.externalRefs ?? []).map((ref) => ({
          provider: ref.provider,
          mediaType: ref.mediaType,
          externalId: ref.externalId,
          connectorKey: ref.connectorKey ?? undefined,
        })),
      })),
    );
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

  async remove(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
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
    const poll = await manager.getRepository(Poll).findOne({
      where: {
        householdId,
        sourceModule: 'media',
        sourceId: mediaId,
        status: 'open',
        isArchived: false,
      },
      order: { createdAt: 'DESC' },
    });
    return Boolean(
      poll && (!poll.closesAt || poll.closesAt.getTime() > Date.now()),
    );
  }
}

@Controller('media')
class MediaController {
  constructor(private readonly service: MediaService) {}

  @Get()
  list(@Query() query: MediaQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('connectors')
  connectors(@Query('refresh') refresh?: string) {
    return this.service.connectorStatus(refresh === 'true');
  }

  @Post('library-availability')
  libraryAvailability(
    @Body() dto: MediaAvailabilityDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.libraryAvailability(dto.mediaIds, user);
  }

  @Post()
  create(@Body() dto: CreateMediaDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HouseholdMedia,
      MediaTitle,
      MediaExternalRef,
      Poll,
    ]),
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaConnectorsService],
  exports: [MediaService, MediaConnectorsService],
})
export class MediaModule {}
