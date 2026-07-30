import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  HouseholdMedia,
  HouseholdMediaSourceConfig,
  HouseholdMediaStatus,
  Integration,
  IntegrationSecret,
  MediaExternalProvider,
  MediaExternalRef,
  MediaLibraryItem,
  MediaRequest,
  MediaRequestStatus,
  MediaTitle,
  MediaType,
  Poll,
  PollOption,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import {
  IntegrationSettingsService,
  UpdateIntegrationSettingsInput,
} from './integration-settings.service';
import { MediaMetadataService } from './media-metadata.service';
import {
  MediaLibraryQuery,
  MediaLibraryService,
} from './media-library.service';
import {
  MediaSourceSettingsService,
  UpdateMediaSourceSettingsInput,
} from './media-source-settings.service';

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

class MediaSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  query: string;

  @IsOptional()
  @IsIn(['movie', 'series'])
  type?: MediaType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1878)
  @Max(2199)
  year?: number;
}

class UpdateMediaSourceSettingsDto
  implements UpdateMediaSourceSettingsInput
{
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string | null;

  @IsOptional()
  @IsIn(['token', 'api_key'])
  credentialKind?: 'token' | 'api_key' | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string | null;
}

class UpdateIntegrationSettingsDto
  implements UpdateIntegrationSettingsInput
{
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

class MediaExternalRefDto {
  @IsIn(['tmdb', 'imdb', 'douban', 'bangumi'])
  provider: Extract<
    MediaExternalProvider,
    'tmdb' | 'imdb' | 'douban' | 'bangumi'
  >;

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

class MediaLibraryQueryDto implements MediaLibraryQuery {
  @IsOptional()
  @IsIn(['plex', 'emby'])
  connectorKey?: string;

  @IsOptional()
  @IsIn(['movie', 'series'])
  type?: MediaType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(12)
  @Max(60)
  pageSize?: number;
}

class SyncMediaLibraryDto {
  @IsOptional()
  @IsIn(['plex', 'emby'])
  connectorKey?: string;
}

class MediaRequestQueryDto {
  @IsOptional()
  @IsUUID('4')
  mediaId?: string;
}

class CreateMediaRequestDto {
  @IsOptional()
  @IsIn(['moviepilot'])
  connectorKey?: 'moviepilot';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  season?: number;
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

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

function connectorErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || '连接 MoviePilot 失败').slice(0, 1000);
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
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
    const media = entries.map((entry) => ({
      id: entry.id,
      mediaTitleId: entry.mediaTitleId,
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

@Injectable()
export class MediaRequestsService {
  constructor(
    @InjectRepository(MediaRequest)
    private readonly mediaRequests: Repository<MediaRequest>,
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  async list(query: MediaRequestQueryDto, user: JwtUser) {
    const requests = await this.mediaRequests.find({
      where: {
        householdId: user.householdId,
        ...(query.mediaId ? { householdMediaId: query.mediaId } : {}),
      },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
    return requests.map((request) => this.present(request, user));
  }

  async create(mediaId: string, dto: CreateMediaRequestDto, user: JwtUser) {
    const connectorKey = dto.connectorKey ?? 'moviepilot';
    let reserved: {
      id: string;
      mediaTitle: MediaTitle;
      season: number;
    };
    try {
      reserved = await this.dataSource.transaction(async (manager) => {
        const entry = await manager
          .getRepository(HouseholdMedia)
          .createQueryBuilder('entry')
          .innerJoinAndSelect('entry.mediaTitle', 'title')
          .leftJoinAndSelect('title.externalRefs', 'externalRef')
          .where('entry.id = :mediaId AND entry.householdId = :householdId', {
            mediaId,
            householdId: user.householdId,
          })
          .setLock('pessimistic_write', undefined, ['entry'])
          .getOne();
        if (!entry) throw new NotFoundException('观影片单不存在');

        const tmdb = entry.mediaTitle.externalRefs.find(
          (reference) => reference.provider === 'tmdb',
        );
        if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
          throw new BadRequestException('提交 MoviePilot 前需要有效的 TMDB ID');
        }
        if (entry.mediaTitle.type === 'series' && !dto.season) {
          throw new BadRequestException('订阅剧集时需要选择季数');
        }
        if (entry.mediaTitle.type === 'movie' && dto.season != null) {
          throw new BadRequestException('电影订阅不需要选择季数');
        }
        const season = entry.mediaTitle.type === 'series' ? dto.season! : 0;
        const repository = manager.getRepository(MediaRequest);
        const request = await repository.save(
          repository.create({
            householdId: user.householdId,
            householdMediaId: entry.id,
            connectorKey,
            season,
            status: 'pending',
            externalRequestId: null,
            message: null,
            requestedById: user.memberId,
            cancelledById: null,
            lastSyncedAt: null,
          }),
        );
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_request_submitted',
          summary: `${user.name} 提交了「${entry.mediaTitle.title}」${season ? `第 ${season} 季` : ''}的 MoviePilot 订阅`,
          targetPath: `/media/watchlist?mediaId=${entry.id}`,
          metadata: {
            mediaId: entry.id,
            mediaRequestId: request.id,
            connectorKey,
            season,
          },
        });
        return { id: request.id, mediaTitle: entry.mediaTitle, season };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这部影视已有相同季数的进行中订阅');
      }
      throw error;
    }

    let externalRequest: Awaited<
      ReturnType<MediaConnectorsService['requestMedia']>
    >;
    try {
      externalRequest = await this.connectors.requestMedia(
        user.householdId,
        connectorKey,
        this.metadataSnapshot(reserved.mediaTitle),
        reserved.id,
        reserved.season ? { season: reserved.season } : {},
      );
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.failCreate(reserved.id, reserved.mediaTitle.title, message, user);
      throw new BadGatewayException(`MoviePilot 订阅失败：${message}`);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const request = await this.lockRequest(manager, reserved.id, user);
        request.status = externalRequest.status;
        request.externalRequestId = externalRequest.requestId;
        request.message = externalRequest.message?.slice(0, 1000) ?? null;
        request.lastSyncedAt = externalRequest.updatedAt;
        await manager.getRepository(MediaRequest).save(request);
        await recordActivity(manager, user, {
          module: 'media',
          action:
            request.status === 'completed'
              ? 'media_request_completed'
              : request.status === 'failed'
                ? 'media_request_failed'
                : 'media_request_accepted',
          summary:
            request.status === 'completed'
              ? `「${reserved.mediaTitle.title}」的 MoviePilot 订阅已完成`
              : request.status === 'failed'
                ? `「${reserved.mediaTitle.title}」的 MoviePilot 订阅失败`
                : `MoviePilot 已接收「${reserved.mediaTitle.title}」的订阅`,
          targetPath: `/media/watchlist?mediaId=${mediaId}`,
          metadata: {
            mediaId,
            mediaRequestId: request.id,
            connectorKey,
            season: request.season,
            status: request.status,
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const message = '这个 MoviePilot 订阅已关联到其他家庭请求';
      await this.failCreate(reserved.id, reserved.mediaTitle.title, message, user);
      throw new ConflictException(message);
    }
    return this.get(reserved.id, user);
  }

  async refresh(id: string, user: JwtUser) {
    const current = await this.getEntity(id, user);
    if (current.status === 'completed' || current.status === 'cancelled') {
      throw new ConflictException('已结束的订阅不能刷新');
    }
    if (!current.externalRequestId) {
      throw new ConflictException('订阅尚未取得 MoviePilot 请求编号');
    }

    let externalRequest: Awaited<
      ReturnType<MediaConnectorsService['getRequest']>
    >;
    try {
      externalRequest = await this.connectors.getRequest(
        user.householdId,
        current.connectorKey,
        current.externalRequestId,
      );
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.recordSyncError(current.id, message, user);
      throw new BadGatewayException(`MoviePilot 状态同步失败：${message}`);
    }

    const title = await this.mediaTitle(current.householdMediaId, user);
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, current.id, user);
      if (request.status === 'completed' || request.status === 'cancelled') {
        throw new ConflictException('订阅状态已经结束，请重新载入最新状态');
      }
      const previousStatus = request.status;
      request.lastSyncedAt = new Date();
      if (!externalRequest) {
        request.status = 'failed';
        request.message = 'MoviePilot 中已找不到这条订阅';
      } else {
        request.status = externalRequest.status;
        request.message = externalRequest.message?.slice(0, 1000) ?? null;
        request.lastSyncedAt = externalRequest.updatedAt;
      }
      await manager.getRepository(MediaRequest).save(request);
      if (
        request.status !== previousStatus &&
        (request.status === 'completed' || request.status === 'failed')
      ) {
        await recordActivity(manager, user, {
          module: 'media',
          action:
            request.status === 'completed'
              ? 'media_request_completed'
              : 'media_request_failed',
          summary:
            request.status === 'completed'
              ? `「${title}」的 MoviePilot 订阅已完成`
              : `「${title}」的 MoviePilot 订阅失败`,
          targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
          metadata: {
            mediaId: request.householdMediaId,
            mediaRequestId: request.id,
            connectorKey: request.connectorKey,
            season: request.season,
            status: request.status,
          },
        });
      }
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: JwtUser) {
    const current = await this.getEntity(id, user);
    if (!['pending', 'processing'].includes(current.status)) {
      throw new ConflictException('只有进行中的订阅可以取消');
    }
    if (
      current.requestedById !== user.memberId &&
      user.role !== 'owner' &&
      user.role !== 'admin'
    ) {
      throw new ForbiddenException('只有请求人或家庭管理员可以取消订阅');
    }
    if (!current.externalRequestId) {
      throw new ConflictException('订阅正在提交，请稍后再取消');
    }

    try {
      await this.connectors.cancelRequest(
        user.householdId,
        current.connectorKey,
        current.externalRequestId,
      );
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.recordSyncError(current.id, message, user);
      throw new BadGatewayException(`取消 MoviePilot 订阅失败：${message}`);
    }

    const title = await this.mediaTitle(current.householdMediaId, user);
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, current.id, user);
      if (!['pending', 'processing'].includes(request.status)) {
        throw new ConflictException('订阅状态已经发生变化，请刷新后重试');
      }
      request.status = 'cancelled';
      request.cancelledById = user.memberId;
      request.message = null;
      request.lastSyncedAt = new Date();
      await manager.getRepository(MediaRequest).save(request);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_request_cancelled',
        summary: `${user.name} 取消了「${title}」${request.season ? `第 ${request.season} 季` : ''}的 MoviePilot 订阅`,
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
        metadata: {
          mediaId: request.householdMediaId,
          mediaRequestId: request.id,
          connectorKey: request.connectorKey,
          season: request.season,
        },
      });
    });
    return this.get(id, user);
  }

  private async get(id: string, user: JwtUser) {
    return this.present(await this.getEntity(id, user), user);
  }

  private async getEntity(id: string, user: JwtUser) {
    const request = await this.mediaRequests.findOne({
      where: { id, householdId: user.householdId },
    });
    if (!request) throw new NotFoundException('MoviePilot 订阅请求不存在');
    return request;
  }

  private async lockRequest(
    manager: EntityManager,
    id: string,
    user: JwtUser,
  ) {
    const request = await manager
      .getRepository(MediaRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.requestedBy', 'requestedBy')
      .leftJoinAndSelect('request.cancelledBy', 'cancelledBy')
      .where('request.id = :id AND request.householdId = :householdId', {
        id,
        householdId: user.householdId,
      })
      .setLock('pessimistic_write', undefined, ['request'])
      .getOne();
    if (!request) throw new NotFoundException('MoviePilot 订阅请求不存在');
    return request;
  }

  private async mediaTitle(mediaId: string, user: JwtUser) {
    const entry = await this.dataSource.manager.getRepository(HouseholdMedia).findOne({
      where: { id: mediaId, householdId: user.householdId },
      relations: { mediaTitle: true },
    });
    if (!entry) throw new NotFoundException('观影片单不存在');
    return entry.mediaTitle.title;
  }

  private metadataSnapshot(title: MediaTitle) {
    return {
      type: title.type,
      title: title.title,
      originalTitle: title.originalTitle,
      year: title.year,
      overview: title.overview,
      posterUrl: title.posterUrl,
      metadata: title.metadata,
      externalRefs: (title.externalRefs ?? []).map((reference) => ({
        provider: reference.provider,
        mediaType: reference.mediaType,
        externalId: reference.externalId,
        connectorKey: reference.connectorKey ?? undefined,
      })),
    };
  }

  private async failCreate(
    id: string,
    title: string,
    message: string,
    user: JwtUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id, user);
      request.status = 'failed';
      request.message = message;
      request.lastSyncedAt = new Date();
      await manager.getRepository(MediaRequest).save(request);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_request_failed',
        summary: `「${title}」的 MoviePilot 订阅失败`,
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
        metadata: {
          mediaId: request.householdMediaId,
          mediaRequestId: request.id,
          connectorKey: request.connectorKey,
          season: request.season,
          message,
        },
      });
    });
  }

  private async recordSyncError(id: string, message: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id, user);
      if (request.status === 'completed' || request.status === 'cancelled') {
        return;
      }
      request.message = `同步失败：${message}`.slice(0, 1000);
      await manager.getRepository(MediaRequest).save(request);
    });
  }

  private present(request: MediaRequest, user: JwtUser) {
    return {
      id: request.id,
      householdMediaId: request.householdMediaId,
      connectorKey: request.connectorKey,
      season: request.season,
      status: request.status as MediaRequestStatus,
      externalRequestId: request.externalRequestId,
      message: request.message,
      requestedBy: {
        id: request.requestedBy.id,
        name: request.requestedBy.name,
        avatarEmoji: request.requestedBy.avatarEmoji,
      },
      cancelledBy: request.cancelledBy
        ? {
            id: request.cancelledBy.id,
            name: request.cancelledBy.name,
            avatarEmoji: request.cancelledBy.avatarEmoji,
          }
        : null,
      canCancel:
        ['pending', 'processing'].includes(request.status) &&
        (request.requestedById === user.memberId ||
          user.role === 'owner' ||
          user.role === 'admin'),
      lastSyncedAt: request.lastSyncedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}

@Controller('media')
class MediaController {
  constructor(
    private readonly service: MediaService,
    private readonly requests: MediaRequestsService,
    private readonly metadata: MediaMetadataService,
    private readonly sourceSettings: MediaSourceSettingsService,
    private readonly integrationSettings: IntegrationSettingsService,
    private readonly connectorsService: MediaConnectorsService,
    private readonly library: MediaLibraryService,
  ) {}

  @Get('search')
  search(@Query() query: MediaSearchDto, @CurrentUser() user: JwtUser) {
    const normalizedQuery = normalizeText(query.query);
    if (!normalizedQuery) {
      throw new BadRequestException('请输入影视名称');
    }
    return this.metadata.search(
      {
        query: normalizedQuery,
        type: query.type,
        year: query.year,
      },
      user.householdId,
    );
  }

  @Get('metadata-sources')
  @RequireCapabilities('manage_integrations')
  metadataSources(@CurrentUser() user: JwtUser) {
    return this.sourceSettings.list(user);
  }

  @Put('metadata-sources/:provider')
  @RequireCapabilities('manage_integrations')
  async updateMetadataSource(
    @Param('provider') providerValue: string,
    @Body() dto: UpdateMediaSourceSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.sourceSettings.isProvider(providerValue)) {
      throw new NotFoundException('影视数据源不存在');
    }
    const result = await this.sourceSettings.update(providerValue, dto, user);
    this.metadata.clearHouseholdCache(user.householdId);
    return result;
  }

  @Delete('metadata-sources/:provider')
  @RequireCapabilities('manage_integrations')
  async resetMetadataSource(
    @Param('provider') providerValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.sourceSettings.isProvider(providerValue)) {
      throw new NotFoundException('影视数据源不存在');
    }
    const result = await this.sourceSettings.reset(providerValue, user);
    this.metadata.clearHouseholdCache(user.householdId);
    return result;
  }

  @Get()
  list(@Query() query: MediaQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('connectors')
  connectors(
    @CurrentUser() user: JwtUser,
    @Query('refresh') refresh?: string,
  ) {
    return this.service.connectorStatus(user, refresh === 'true');
  }

  @Get('connector-settings')
  @RequireCapabilities('manage_integrations')
  connectorSettings(@CurrentUser() user: JwtUser) {
    return this.integrationSettings.list(user);
  }

  @Put('connector-settings/:kind')
  @RequireCapabilities('manage_integrations')
  async updateConnectorSettings(
    @Param('kind') kindValue: string,
    @Body() dto: UpdateIntegrationSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    const result = await this.integrationSettings.update(kindValue, dto, user);
    this.connectorsService.clearHouseholdCache(user.householdId);
    return result;
  }

  @Delete('connector-settings/:kind')
  @RequireCapabilities('manage_integrations')
  async resetConnectorSettings(
    @Param('kind') kindValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    const result = await this.integrationSettings.reset(kindValue, user);
    this.connectorsService.clearHouseholdCache(user.householdId);
    return result;
  }

  @Post('connector-settings/:kind/test')
  @RequireCapabilities('manage_integrations')
  testConnectorSettings(
    @Param('kind') kindValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    return this.connectorsService.test(user.householdId, kindValue);
  }

  @Post('library-availability')
  libraryAvailability(
    @Body() dto: MediaAvailabilityDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.libraryAvailability(dto.mediaIds, user);
  }

  @Get('library')
  mediaLibrary(
    @Query() query: MediaLibraryQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.list(query, user);
  }

  @Post('library/sync')
  @RequireCapabilities('manage_integrations')
  syncMediaLibrary(
    @Body() dto: SyncMediaLibraryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.sync(dto.connectorKey, user);
  }

  @Post('library/:libraryItemId/add')
  addLibraryItem(
    @Param('libraryItemId', ParseUUIDPipe) libraryItemId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.addToWatchlist(libraryItemId, user);
  }

  @Get('requests')
  mediaRequests(
    @Query() query: MediaRequestQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.list(query, user);
  }

  @Post(':mediaId/requests')
  createMediaRequest(
    @Param('mediaId') mediaId: string,
    @Body() dto: CreateMediaRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.create(mediaId, dto, user);
  }

  @Post('requests/:requestId/refresh')
  refreshMediaRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.refresh(requestId, user);
  }

  @Delete('requests/:requestId')
  cancelMediaRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.cancel(requestId, user);
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
      HouseholdMediaSourceConfig,
      Integration,
      IntegrationSecret,
      MediaTitle,
      MediaExternalRef,
      MediaLibraryItem,
      MediaRequest,
      Poll,
    ]),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaRequestsService,
    MediaConnectorsService,
    MediaLibraryService,
    IntegrationSettingsService,
    MediaSourceSettingsService,
    MediaMetadataService,
  ],
  exports: [MediaService, MediaRequestsService, MediaConnectorsService],
})
export class MediaModule {}
