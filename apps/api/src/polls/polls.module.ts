import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
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
  Member,
  Notification,
  Poll,
  PollCategory,
  PollOption,
  PollVote,
  PollVoteMode,
} from '../entities';

class PollQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed', 'all'])
  status?: 'open' | 'closed' | 'all';
}

class PollOptionDto {
  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

class CreatePollDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsIn(['general', 'meal', 'activity', 'movie', 'shopping'])
  category?: PollCategory;

  @IsOptional()
  @IsIn(['single', 'multiple'])
  voteMode?: PollVoteMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxChoices?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  closesAt?: string | null;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PollOptionDto)
  options: PollOptionDto[];

  @IsOptional()
  @IsIn(['media'])
  sourceModule?: 'media';

  @IsOptional()
  @IsUUID('4')
  sourceId?: string;
}

class UpdatePollDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsIn(['general', 'meal', 'activity', 'movie', 'shopping'])
  category?: PollCategory;

  @IsOptional()
  @IsIn(['single', 'multiple'])
  voteMode?: PollVoteMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxChoices?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  closesAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PollOptionDto)
  options?: PollOptionDto[];
}

class VoteDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  optionIds: string[];
}

function isAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

function effectiveStatus(poll: Poll) {
  if (poll.status === 'closed') return 'closed' as const;
  if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
    return 'closed' as const;
  }
  return 'open' as const;
}

function normalizeOptions(options: PollOptionDto[]) {
  const normalized = options.map((option) => ({
    label: option.label.trim(),
    description: option.description?.trim() || null,
  }));
  if (normalized.some((option) => !option.label)) {
    throw new BadRequestException('候选项不能为空');
  }
  const labels = normalized.map((option) => option.label.toLocaleLowerCase('zh-CN'));
  if (new Set(labels).size !== labels.length) {
    throw new BadRequestException('候选项不能重复');
  }
  return normalized;
}

function parseClosesAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException('截止时间无效');
  }
  return date;
}

@Injectable()
export class PollsService {
  constructor(
    @InjectRepository(Poll)
    private readonly polls: Repository<Poll>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: PollQueryDto, user: JwtUser) {
    const polls = await this.polls.find({
      where: { householdId: user.householdId, isArchived: false },
      relations: { options: { votes: { member: true } } },
      order: { createdAt: 'DESC', options: { sortOrder: 'ASC' } },
      take: 50,
    });
    const rows = polls.map((poll) => this.present(poll, user));
    if (!query.status || query.status === 'all') return rows;
    return rows.filter((poll) => poll.status === query.status);
  }

  async create(dto: CreatePollDto, user: JwtUser) {
    const options = normalizeOptions(dto.options);
    const voteMode = dto.voteMode ?? 'single';
    const maxChoices = dto.maxChoices ?? (voteMode === 'single' ? 1 : 2);
    this.validateRules(voteMode, maxChoices, options.length);
    const closesAt = parseClosesAt(dto.closesAt);
    if (closesAt && closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('截止时间必须晚于当前时间');
    }
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('投票标题不能为空');

    const id = await this.dataSource.transaction(async (manager) => {
      const source = await this.prepareSource(dto, user, manager);
      const polls = manager.getRepository(Poll);
      const pollOptions = manager.getRepository(PollOption);
      const poll = await polls.save(
        polls.create({
          householdId: user.householdId,
          title,
          description: dto.description?.trim() || null,
          category: source?.module === 'media' ? 'movie' : (dto.category ?? 'general'),
          voteMode,
          maxChoices,
          closesAt,
          status: 'open',
          sourceModule: source?.module ?? null,
          sourceId: source?.id ?? null,
          createdById: user.memberId,
        }),
      );
      await pollOptions.save(
        options.map((option, sortOrder) =>
          pollOptions.create({ pollId: poll.id, ...option, sortOrder }),
        ),
      );
      await this.notifyHousehold(
        manager,
        poll,
        user,
        'poll_created',
        `${user.name}发起了「${poll.title}」`,
      );
      if (source?.module === 'media') {
        if (source.entry.status === 'watchlist') {
          source.entry.status = 'voting';
          source.entry.scheduledFor = null;
          await manager.getRepository(HouseholdMedia).save(source.entry);
        }
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_poll_started',
          summary: `${user.name} 为「${source.entry.mediaTitle.title}」发起了家庭投票`,
          targetPath: `/polls?pollId=${poll.id}`,
          metadata: {
            mediaId: source.entry.id,
            pollId: poll.id,
          },
        });
      }
      return poll.id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: UpdatePollDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const poll = await this.lockPoll(id, user, manager);
      this.assertManageable(poll, user);
      const votes = manager.getRepository(PollVote);
      const pollOptions = manager.getRepository(PollOption);
      const voteCount = await votes.countBy({ pollId: poll.id });
      const currentOptionCount = await pollOptions.countBy({ pollId: poll.id });
      const options = dto.options ? normalizeOptions(dto.options) : null;
      const optionCount = options?.length ?? currentOptionCount;
      const voteMode = dto.voteMode ?? poll.voteMode;
      const modeChanged = dto.voteMode != null && dto.voteMode !== poll.voteMode;
      const maxChoices =
        dto.maxChoices ??
        (modeChanged ? (voteMode === 'single' ? 1 : Math.min(2, optionCount)) : poll.maxChoices);
      this.validateRules(voteMode, maxChoices, optionCount);
      if (voteCount && (options || modeChanged || dto.maxChoices != null)) {
        throw new ConflictException('已经有人投票，只能修改标题、说明、分类或截止时间');
      }

      if (dto.title != null) {
        const title = dto.title.trim();
        if (!title) throw new BadRequestException('投票标题不能为空');
        poll.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
        poll.description = dto.description?.trim() || null;
      }
      if (dto.category) poll.category = dto.category;
      poll.voteMode = voteMode;
      poll.maxChoices = maxChoices;
      if (Object.prototype.hasOwnProperty.call(dto, 'closesAt')) {
        const closesAt = parseClosesAt(dto.closesAt);
        if (closesAt && closesAt.getTime() <= Date.now()) {
          throw new BadRequestException('截止时间必须晚于当前时间');
        }
        poll.closesAt = closesAt;
      }
      await manager.getRepository(Poll).save(poll);

      if (options) {
        await pollOptions.delete({ pollId: poll.id });
        await pollOptions.save(
          options.map((option, sortOrder) =>
            pollOptions.create({ pollId: poll.id, ...option, sortOrder }),
          ),
        );
      }
    });
    return this.get(id, user);
  }

  async vote(id: string, dto: VoteDto, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const poll = await this.lockPoll(id, user, manager);
      if (effectiveStatus(poll) !== 'open') {
        throw new ConflictException('投票已经结束');
      }
      const pollOptions = manager.getRepository(PollOption);
      const options = await pollOptions.findBy({ pollId: poll.id });
      if (dto.optionIds.length > poll.maxChoices) {
        throw new BadRequestException(`最多选择 ${poll.maxChoices} 项`);
      }
      if (poll.voteMode === 'single' && dto.optionIds.length > 1) {
        throw new BadRequestException('这是单选投票');
      }
      const validIds = new Set(options.map((option) => option.id));
      if (dto.optionIds.some((optionId) => !validIds.has(optionId))) {
        throw new NotFoundException('候选项不属于这个投票');
      }
      const votes = manager.getRepository(PollVote);
      await votes.delete({
        householdId: user.householdId,
        pollId: poll.id,
        memberId: user.memberId,
      });
      if (dto.optionIds.length) {
        await votes.save(
          dto.optionIds.map((optionId) =>
            votes.create({
              householdId: user.householdId,
              pollId: poll.id,
              optionId,
              memberId: user.memberId,
            }),
          ),
        );
      }
    });
    return this.get(id, user);
  }

  async close(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const poll = await this.lockPoll(id, user, manager);
      this.assertManageable(poll, user);
      if (poll.status === 'closed') return;
      poll.status = 'closed';
      poll.closedAt = new Date();
      poll.closedById = user.memberId;
      await manager.getRepository(Poll).save(poll);
      await this.syncMediaSource(manager, poll, user, 'closed');
      await this.notifyHousehold(
        manager,
        poll,
        user,
        'poll_closed',
        `「${poll.title}」投票已结束`,
      );
    });
    return this.get(id, user);
  }

  async reopen(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const preview = await manager.getRepository(Poll).findOneBy({
        id,
        householdId: user.householdId,
        isArchived: false,
      });
      if (!preview) throw new NotFoundException('家庭投票不存在');
      await this.lockMediaPollSource(manager, preview);
      const poll = await this.lockPoll(id, user, manager);
      this.assertManageable(poll, user);
      if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
        throw new ConflictException('请先把截止时间修改到未来再重新开启');
      }
      if (poll.status === 'open' && effectiveStatus(poll) === 'open') {
        await this.syncMediaSource(manager, poll, user, 'reopened');
        return;
      }
      await this.assertNoOtherActiveMediaPoll(manager, poll);
      poll.status = 'open';
      poll.closedAt = null;
      poll.closedById = null;
      await manager.getRepository(Poll).save(poll);
      await this.syncMediaSource(manager, poll, user, 'reopened');
      await this.notifyHousehold(
        manager,
        poll,
        user,
        'poll_reopened',
        `「${poll.title}」重新开放投票`,
      );
    });
    return this.get(id, user);
  }

  async archive(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const poll = await this.lockPoll(id, user, manager);
      this.assertManageable(poll, user);
      poll.isArchived = true;
      await manager.getRepository(Poll).save(poll);
      await this.syncMediaSource(manager, poll, user, 'archived');
    });
    return { id, archived: true as const };
  }

  async get(id: string, user: JwtUser) {
    const poll = await this.polls.findOne({
      where: { id, householdId: user.householdId, isArchived: false },
      relations: { options: { votes: { member: true } } },
      order: { options: { sortOrder: 'ASC' } },
    });
    if (!poll) throw new NotFoundException('家庭投票不存在');
    return this.present(poll, user);
  }

  private present(poll: Poll, user: JwtUser) {
    const options = [...(poll.options ?? [])].sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
    const voterIds = new Set(
      options.flatMap((option) => option.votes.map((vote) => vote.memberId)),
    );
    const selectedOptionIds = options
      .filter((option) =>
        option.votes.some((vote) => vote.memberId === user.memberId),
      )
      .map((option) => option.id);
    const totalVoters = voterIds.size;
    const status = effectiveStatus(poll);
    return {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      category: poll.category,
      voteMode: poll.voteMode,
      maxChoices: poll.maxChoices,
      closesAt: poll.closesAt?.toISOString() ?? null,
      status,
      sourceModule: poll.sourceModule,
      sourceId: poll.sourceId,
      createdById: poll.createdById,
      createdBy: poll.createdBy,
      closedById: poll.closedById,
      closedBy: poll.closedBy,
      closedAt: poll.closedAt?.toISOString() ?? null,
      createdAt: poll.createdAt,
      updatedAt: poll.updatedAt,
      canManage: poll.createdById === user.memberId || isAdmin(user),
      canVote: status === 'open',
      totalVoters,
      totalVotes: options.reduce((sum, option) => sum + option.votes.length, 0),
      selectedOptionIds,
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        sortOrder: option.sortOrder,
        voteCount: option.votes.length,
        percentage: totalVoters
          ? Math.round((option.votes.length / totalVoters) * 100)
          : 0,
        voters: option.votes
          .map((vote) => vote.member)
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      })),
    };
  }

  private validateRules(
    voteMode: PollVoteMode,
    maxChoices: number,
    optionCount: number,
  ) {
    if (voteMode === 'single' && maxChoices !== 1) {
      throw new BadRequestException('单选投票的最多选择数必须是 1');
    }
    if (voteMode === 'multiple' && maxChoices < 2) {
      throw new BadRequestException('多选投票至少允许选择 2 项');
    }
    if (maxChoices > optionCount) {
      throw new BadRequestException('最多选择数不能超过候选项数量');
    }
  }

  private assertManageable(poll: Poll, user: JwtUser) {
    if (poll.createdById !== user.memberId && !isAdmin(user)) {
      throw new ForbiddenException('只能管理自己发起的投票');
    }
  }

  private async prepareSource(
    dto: CreatePollDto,
    user: JwtUser,
    manager: EntityManager,
  ) {
    if (Boolean(dto.sourceModule) !== Boolean(dto.sourceId)) {
      throw new BadRequestException('投票来源模块和来源 ID 必须同时提供');
    }
    if (!dto.sourceModule || !dto.sourceId) return null;

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`poll-source:${user.householdId}:${dto.sourceModule}:${dto.sourceId}`],
    );
    const entry = await manager
      .getRepository(HouseholdMedia)
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
      .where('entry.id = :id AND entry.householdId = :householdId', {
        id: dto.sourceId,
        householdId: user.householdId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!entry) throw new NotFoundException('观影片单不存在');
    if (entry.status !== 'watchlist' && entry.status !== 'voting') {
      throw new ConflictException('只有想看或投票中的影视可以发起投票');
    }

    const pollRepository = manager.getRepository(Poll);
    const existing = await pollRepository.find({
      where: {
        householdId: user.householdId,
        sourceModule: 'media',
        sourceId: entry.id,
        status: 'open',
        isArchived: false,
      },
      order: { createdAt: 'DESC' },
    });
    for (const poll of existing) {
      if (effectiveStatus(poll) === 'open') {
        throw new ConflictException('这部影视已经有进行中的家庭投票');
      }
      poll.status = 'closed';
      poll.closedAt = poll.closesAt ?? new Date();
      await pollRepository.save(poll);
    }
    return { module: 'media' as const, id: entry.id, entry };
  }

  private async syncMediaSource(
    manager: EntityManager,
    poll: Poll,
    user: JwtUser,
    action: 'closed' | 'reopened' | 'archived',
  ) {
    if (poll.sourceModule !== 'media' || !poll.sourceId) return;
    const entry = await manager
      .getRepository(HouseholdMedia)
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
      .where('entry.id = :id AND entry.householdId = :householdId', {
        id: poll.sourceId,
        householdId: user.householdId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!entry) {
      if (action === 'reopened') {
        throw new ConflictException('来源片单已不存在，不能重新开启投票');
      }
      return;
    }

    if (action === 'reopened') {
      if (entry.status !== 'watchlist' && entry.status !== 'voting') {
        throw new ConflictException('当前观影状态不能重新开启投票');
      }
      if (entry.status === 'watchlist') {
        entry.status = 'voting';
        entry.scheduledFor = null;
        await manager.getRepository(HouseholdMedia).save(entry);
      }
    } else if (
      entry.status === 'voting' &&
      !(await this.hasOtherActiveMediaPoll(manager, poll))
    ) {
      entry.status = 'watchlist';
      entry.scheduledFor = null;
      await manager.getRepository(HouseholdMedia).save(entry);
    }

    await recordActivity(manager, user, {
      module: 'media',
      action: `media_poll_${action}`,
      summary:
        action === 'reopened'
          ? `${user.name} 重新开启了「${entry.mediaTitle.title}」的家庭投票`
          : `${user.name} ${action === 'closed' ? '结束' : '移除'}了「${entry.mediaTitle.title}」的家庭投票`,
      targetPath: `/media?mediaId=${entry.id}`,
      metadata: { mediaId: entry.id, pollId: poll.id },
    });
  }

  private async hasOtherActiveMediaPoll(
    manager: EntityManager,
    poll: Poll,
  ) {
    if (poll.sourceModule !== 'media' || !poll.sourceId) return false;
    const other = await manager
      .getRepository(Poll)
      .createQueryBuilder('poll')
      .where('poll.householdId = :householdId', {
        householdId: poll.householdId,
      })
      .andWhere('poll.sourceModule = :sourceModule', { sourceModule: 'media' })
      .andWhere('poll.sourceId = :sourceId', { sourceId: poll.sourceId })
      .andWhere('poll.id <> :id', { id: poll.id })
      .andWhere('poll.status = :status', { status: 'open' })
      .andWhere('poll.isArchived = false')
      .orderBy('poll.createdAt', 'DESC')
      .getOne();
    return Boolean(other && effectiveStatus(other) === 'open');
  }

  private async lockMediaPollSource(manager: EntityManager, poll: Poll) {
    if (poll.sourceModule !== 'media' || !poll.sourceId) return;
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`poll-source:${poll.householdId}:media:${poll.sourceId}`],
    );
  }

  private async assertNoOtherActiveMediaPoll(
    manager: EntityManager,
    poll: Poll,
  ) {
    if (poll.sourceModule !== 'media' || !poll.sourceId) return;
    const repository = manager.getRepository(Poll);
    const others = await repository
      .createQueryBuilder('poll')
      .where('poll.householdId = :householdId', {
        householdId: poll.householdId,
      })
      .andWhere('poll.sourceModule = :sourceModule', { sourceModule: 'media' })
      .andWhere('poll.sourceId = :sourceId', { sourceId: poll.sourceId })
      .andWhere('poll.id <> :id', { id: poll.id })
      .andWhere('poll.status = :status', { status: 'open' })
      .andWhere('poll.isArchived = false')
      .orderBy('poll.createdAt', 'DESC')
      .getMany();
    for (const other of others) {
      if (effectiveStatus(other) === 'open') {
        throw new ConflictException('这部影视已经有另一个进行中的家庭投票');
      }
      other.status = 'closed';
      other.closedAt = other.closesAt ?? new Date();
      await repository.save(other);
    }
  }

  private async lockPoll(
    id: string,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const poll = await manager
      .getRepository(Poll)
      .createQueryBuilder('poll')
      .where('poll.id = :id', { id })
      .andWhere('poll.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('poll.isArchived = false')
      .setLock('pessimistic_write')
      .getOne();
    if (!poll) throw new NotFoundException('家庭投票不存在');
    return poll;
  }

  private async notifyHousehold(
    manager: EntityManager,
    poll: Poll,
    actor: JwtUser,
    type: 'poll_created' | 'poll_closed' | 'poll_reopened',
    title: string,
  ) {
    const members = await manager.getRepository(Member).findBy({
      householdId: actor.householdId,
    });
    const recipients = members.filter((member) => member.id !== actor.memberId);
    if (!recipients.length) return;
    const notifications = manager.getRepository(Notification);
    await notifications.save(
      recipients.map((member) =>
        notifications.create({
          householdId: actor.householdId,
          recipientId: member.id,
          module: 'poll',
          type,
          sourceId: poll.id,
          title: title.slice(0, 160),
          body: poll.description?.slice(0, 500) || null,
          targetPath: `/polls?pollId=${poll.id}`,
        }),
      ),
    );
  }
}

@Controller()
export class PollsController {
  constructor(private readonly service: PollsService) {}

  @Get('polls')
  list(@Query() query: PollQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Post('polls')
  create(@Body() dto: CreatePollDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('polls/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePollDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('polls/:id/votes')
  vote(
    @Param('id') id: string,
    @Body() dto: VoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.vote(id, dto, user);
  }

  @Post('polls/:id/close')
  close(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.close(id, user);
  }

  @Post('polls/:id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.reopen(id, user);
  }

  @Delete('polls/:id')
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archive(id, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Poll,
      PollOption,
      PollVote,
      Member,
      Notification,
      HouseholdMedia,
    ]),
  ],
  controllers: [PollsController],
  providers: [PollsService],
  exports: [PollsService],
})
export class PollsModule {}
