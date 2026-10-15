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
import { HouseholdMedia, GuestPollVote, Poll, PollOption, PollVote } from '../entities';
import {
  type CreatePollBody,
  type PollListQuery,
  type UpdatePollBody,
  type VoteBody,
} from '@family/contracts';
import {
  effectiveStatus,
  normalizeOptions,
  parseClosesAt,
  present,
  validateRules,
  assertManageable,
  lockPoll,
  notifyHousehold,
} from './polls.helpers';
import {
  prepareSource,
  prepareMediaCandidates,
  syncMediaSources,
  lockMediaPollSources,
  assertNoOtherActiveMediaPoll,
} from './polls.media-sources';

@Injectable()
export class PollsService {
  constructor(
    @InjectRepository(Poll)
    private readonly polls: Repository<Poll>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: PollListQuery, user: JwtUser) {
    const polls = await this.polls.find({
      where: { householdId: user.householdId, isArchived: false },
      relations: {
        options: { media: { mediaTitle: true }, votes: { member: true }, guestVotes: true },
      },
      order: { createdAt: 'DESC', options: { sortOrder: 'ASC' } },
      take: 50,
    });
    const rows = polls.map((poll) => present(poll, user));
    if (!query.status || query.status === 'all') return rows;
    return rows.filter((poll) => poll.status === query.status);
  }

  async create(dto: CreatePollBody, user: JwtUser) {
    const id = await this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager),
    );
    return this.get(id, user);
  }

  async createWithinTransaction(
    dto: CreatePollBody,
    user: JwtUser,
    manager: EntityManager,
  ) {
    const options = normalizeOptions(dto.options);
    const hasMediaCandidates = options.every((option) => option.mediaId);
    if (hasMediaCandidates && (dto.sourceModule || dto.sourceId)) {
      throw new BadRequestException('多片候选投票不能再关联单独的来源片单');
    }
    if (hasMediaCandidates && dto.category && dto.category !== 'movie') {
      throw new BadRequestException('影视候选项只能用于观影投票');
    }
    const voteMode = dto.voteMode ?? 'single';
    const maxChoices = dto.maxChoices ?? (voteMode === 'single' ? 1 : 2);
    validateRules(voteMode, maxChoices, options.length);
    const closesAt = parseClosesAt(dto.closesAt);
    if (closesAt && closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('截止时间必须晚于当前时间');
    }
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('投票标题不能为空');

    const source = await prepareSource(dto, user, manager);
    const mediaCandidates = hasMediaCandidates
      ? await prepareMediaCandidates(
          options.map((option) => option.mediaId as string),
          user,
          manager,
        )
      : [];
    const polls = manager.getRepository(Poll);
    const pollOptions = manager.getRepository(PollOption);
    const poll = await polls.save(
      polls.create({
        householdId: user.householdId,
        title,
        description: dto.description?.trim() || null,
        category:
          source?.module === 'media' || mediaCandidates.length
            ? 'movie'
            : (dto.category ?? 'general'),
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
      options.map((option, sortOrder) => {
        const media = mediaCandidates[sortOrder];
        return pollOptions.create({
          pollId: poll.id,
          label: media?.mediaTitle.title.slice(0, 120) || option.label,
          description: option.description,
          mediaId: media?.id ?? null,
          sortOrder,
        });
      }),
    );
    await notifyHousehold(
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
    if (mediaCandidates.length) {
      const changed = mediaCandidates.filter(
        (entry) => entry.status === 'watchlist',
      );
      for (const entry of changed) {
        entry.status = 'voting';
        entry.scheduledFor = null;
      }
      if (changed.length) {
        await manager.getRepository(HouseholdMedia).save(changed);
      }
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_poll_started',
        summary: `${user.name} 发起了 ${mediaCandidates.length} 部候选影视的家庭投票`,
        targetPath: `/polls?pollId=${poll.id}`,
        metadata: {
          mediaIds: mediaCandidates.map((entry) => entry.id),
          pollId: poll.id,
        },
      });
    }
    return poll.id;
  }

  async update(id: string, dto: UpdatePollBody, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const poll = await lockPoll(id, user, manager);
      assertManageable(poll, user);
      const votes = manager.getRepository(PollVote);
      const pollOptions = manager.getRepository(PollOption);
      const voteCount =
        (await votes.countBy({ pollId: poll.id })) +
        (await manager.getRepository(GuestPollVote).countBy({ pollId: poll.id }));
      const currentOptions = await pollOptions.find({
        where: { pollId: poll.id },
        order: { sortOrder: 'ASC' },
      });
      const hasMediaCandidates = currentOptions.some((option) => option.mediaId);
      if (hasMediaCandidates && dto.options) {
        throw new ConflictException('选片投票不能修改候选影视，请重新发起投票');
      }
      if (hasMediaCandidates && dto.category && dto.category !== 'movie') {
        throw new ConflictException('选片投票必须保留为观影分类');
      }
      const options = dto.options ? normalizeOptions(dto.options) : null;
      const optionCount = options?.length ?? currentOptions.length;
      const voteMode = dto.voteMode ?? poll.voteMode;
      const modeChanged = dto.voteMode != null && dto.voteMode !== poll.voteMode;
      const maxChoices =
        dto.maxChoices ??
        (modeChanged ? (voteMode === 'single' ? 1 : Math.min(2, optionCount)) : poll.maxChoices);
      const optionsChanged =
        options != null &&
        (options.length !== currentOptions.length ||
          options.some(
            (option, index) =>
              option.label !== currentOptions[index]?.label ||
              option.description !== currentOptions[index]?.description,
          ));
      const maxChoicesChanged =
        dto.maxChoices != null && dto.maxChoices !== poll.maxChoices;
      validateRules(voteMode, maxChoices, optionCount);
      if (voteCount && (optionsChanged || modeChanged || maxChoicesChanged)) {
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

      if (options && optionsChanged) {
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

  async vote(id: string, dto: VoteBody, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const poll = await lockPoll(id, user, manager);
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
      const preview = await manager.getRepository(Poll).findOneBy({
        id,
        householdId: user.householdId,
        isArchived: false,
      });
      if (!preview) throw new NotFoundException('家庭投票不存在');
      await lockMediaPollSources(manager, preview);
      const poll = await lockPoll(id, user, manager);
      assertManageable(poll, user);
      if (poll.status === 'closed') return;
      poll.status = 'closed';
      poll.closedAt = new Date();
      poll.closedById = user.memberId;
      await manager.getRepository(Poll).save(poll);
      await syncMediaSources(manager, poll, user, 'closed');
      await notifyHousehold(
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
      await lockMediaPollSources(manager, preview);
      const poll = await lockPoll(id, user, manager);
      assertManageable(poll, user);
      if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
        throw new ConflictException('请先把截止时间修改到未来再重新开启');
      }
      if (poll.status === 'open' && effectiveStatus(poll) === 'open') {
        await syncMediaSources(manager, poll, user, 'reopened');
        return;
      }
      await assertNoOtherActiveMediaPoll(manager, poll);
      poll.status = 'open';
      poll.closedAt = null;
      poll.closedById = null;
      await manager.getRepository(Poll).save(poll);
      await syncMediaSources(manager, poll, user, 'reopened');
      await notifyHousehold(
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
      const preview = await manager.getRepository(Poll).findOneBy({
        id,
        householdId: user.householdId,
        isArchived: false,
      });
      if (!preview) throw new NotFoundException('家庭投票不存在');
      await lockMediaPollSources(manager, preview);
      const poll = await lockPoll(id, user, manager);
      assertManageable(poll, user);
      poll.isArchived = true;
      await manager.getRepository(Poll).save(poll);
      await syncMediaSources(manager, poll, user, 'archived');
      await manager
        .getRepository(PollOption)
        .createQueryBuilder()
        .update(PollOption)
        .set({ mediaId: null })
        .where('"pollId" = :pollId', { pollId: poll.id })
        .andWhere('"mediaId" IS NOT NULL')
        .execute();
    });
    return { id, archived: true as const };
  }

  async get(id: string, user: JwtUser) {
    const poll = await this.polls.findOne({
      where: { id, householdId: user.householdId, isArchived: false },
      relations: {
        options: { media: { mediaTitle: true }, votes: { member: true }, guestVotes: true },
      },
      order: { options: { sortOrder: 'ASC' } },
    });
    if (!poll) throw new NotFoundException('家庭投票不存在');
    return present(poll, user);
  }
}
