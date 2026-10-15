import { EventBus } from '../events/event-bus';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import {
  GuestInvitation,
  GuestMealRequest,
  GuestPollVote,
  Menu,
  MenuItem,
  Notification,
  Poll,
  PollOption,
  VisitGuest,
} from '../entities';
import { GuestResponseDto, GuestPollVoteDto, GuestMealRequestDto } from './guests.dto';
import {
  hashToken,
  dateOnly,
  visitMealDates,
  profileGuestMealRequest,
  publicProfile,
  assertMovieVotingAllowed,
  assertMealRequestsAllowed,
  mealLabel,
  publicMoviePollProfile,
} from './guests.helpers';

/** 访客公开页（凭邀请链接，不登录）：看邀请、回复出席、点菜与认领、给选片投票（J7.2 从 GuestsService 拆出）。 */
@Injectable()
export class GuestPortalService {
  constructor(
    private readonly events: EventBus,
    @InjectRepository(VisitGuest)
    private readonly visitGuests: Repository<VisitGuest>,
    @InjectRepository(Poll) private readonly polls: Repository<Poll>,
    @InjectRepository(GuestPollVote)
    private readonly guestPollVotes: Repository<GuestPollVote>,
    @InjectRepository(GuestMealRequest)
    private readonly guestMealRequests: Repository<GuestMealRequest>,
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    private readonly dataSource: DataSource,
  ) {}

  async publicInvitation(token: string) {
    const invitation = await this.activeInvitation(token);
    const participant = await this.visitGuests.findOneBy({
      visitId: invitation.visitId,
      guestId: invitation.guestId,
    });
    return publicProfile(invitation, participant);
  }

  async respond(token: string, dto: GuestResponseDto) {
    let householdId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      householdId = invitation.visit.householdId;
      const participant = await manager.getRepository(VisitGuest).findOneBy({
        visitId: invitation.visitId,
        guestId: invitation.guestId,
      });
      if (!participant) throw new NotFoundException('来访参与关系不存在');
      if (participant.respondedAt) return publicProfile(invitation, participant);
      const now = new Date();
      participant.isAttending = dto.attending;
      participant.respondedAt = now;
      invitation.acceptedAt = invitation.acceptedAt ?? now;
      await Promise.all([
        manager.getRepository(VisitGuest).save(participant),
        manager.getRepository(GuestInvitation).save(invitation),
      ]);
      await manager.getRepository(Notification).save(
        manager.getRepository(Notification).create({
          householdId: invitation.visit.householdId,
          recipientId: invitation.visit.hostMemberId,
          module: 'guest',
          type: 'guest_response',
          sourceId: invitation.visitId,
          title: `访客${dto.attending ? '确认参加' : '婉拒来访'}`,
          body: `${invitation.guest.name}${dto.attending ? ' 将参加' : ' 无法参加'}「${invitation.visit.title}」`,
          targetPath: `/guests?visitId=${invitation.visitId}`,
          readAt: null,
        }),
      );
      return publicProfile(invitation, participant);
    });
    // 访客公开页没有登录用户，拦截器不知道是哪家；事务提交后在这里发（见 contracts EVENT_ROUTES）
    if (householdId) this.events.publish({ householdId, domains: ['guests'] });
    return result;
  }

  async publicMoviePolls(token: string) {
    const invitation = await this.activeInvitation(token);
    assertMovieVotingAllowed(invitation);
    const polls = await this.polls.find({
      where: {
        householdId: invitation.visit.householdId,
        category: 'movie',
        status: 'open',
        isArchived: false,
      },
      relations: { options: { media: { mediaTitle: true }, votes: true, guestVotes: true } },
      order: { createdAt: 'DESC', options: { sortOrder: 'ASC' } },
      take: 20,
    });
    const current = await this.guestPollVotes.find({
      where: { invitationId: invitation.id },
    });
    const selectedByPoll = new Map<string, string[]>();
    for (const vote of current) {
      selectedByPoll.set(vote.pollId, [...(selectedByPoll.get(vote.pollId) ?? []), vote.optionId]);
    }
    return polls
      .filter((poll) => !poll.closesAt || poll.closesAt.getTime() > Date.now())
      .map((poll) => publicMoviePollProfile(poll, selectedByPoll.get(poll.id) ?? []));
  }

  async publicMealRequests(token: string) {
    const invitation = await this.activeInvitation(token);
    assertMealRequestsAllowed(invitation);
    const requests = await this.guestMealRequests.find({
      where: { invitationId: invitation.id },
      order: { mealDate: 'ASC', mealType: 'ASC' },
    });
    return requests.map(profileGuestMealRequest);
  }

  async publicMealOptions(token: string) {
    const invitation = await this.activeInvitation(token);
    assertMealRequestsAllowed(invitation);
    const dates = visitMealDates(invitation.visit);
    const [menus, requests] = await Promise.all([
      this.menus.find({
        where: { householdId: invitation.visit.householdId, date: In(dates), status: 'open' },
        relations: { items: { dish: true } },
        order: { date: 'ASC', mealType: 'ASC', items: { createdAt: 'ASC' } },
      }),
      this.guestMealRequests.find({ where: { invitationId: invitation.id } }),
    ]);
    const requestByMenuItem = new Map(
      requests.filter((request) => request.menuItemId).map((request) => [request.menuItemId!, request]),
    );
    return menus.map((menu) => ({
      id: menu.id,
      mealDate: menu.date,
      mealType: menu.mealType,
      items: (menu.items ?? [])
        .filter((item) => item.status !== 'rejected' && item.dish.isActive)
        .map((item) => ({
          id: item.id,
          dishName: item.dish.name,
          dishCategory: item.dish.category,
          photoUrl: item.dish.photoUrl,
          request: requestByMenuItem.has(item.id)
            ? profileGuestMealRequest(requestByMenuItem.get(item.id)!)
            : null,
        })),
    })).filter((menu) => menu.items.length);
  }

  async claimMealOption(token: string, menuItemId: string) {
    let householdId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      householdId = invitation.visit.householdId;
      assertMealRequestsAllowed(invitation);
      const item = await manager.getRepository(MenuItem)
        .createQueryBuilder('item')
        .innerJoinAndSelect('item.menu', 'menu')
        .innerJoinAndSelect('item.dish', 'dish')
        .where('item.id = :menuItemId', { menuItemId })
        .andWhere('menu.householdId = :householdId', { householdId: invitation.visit.householdId })
        .andWhere('menu.status = :status', { status: 'open' })
        .andWhere('item.status != :rejected', { rejected: 'rejected' })
        .setLock('pessimistic_write')
        .getOne();
      if (!item || !item.dish.isActive || !visitMealDates(invitation.visit).includes(item.menu.date)) {
        throw new NotFoundException('可选择的菜单菜品不存在');
      }
      const requests = manager.getRepository(GuestMealRequest);
      const existing = await requests.findOneBy({ invitationId: invitation.id, menuItemId: item.id });
      if (existing) return profileGuestMealRequest(existing);
      const saved = await requests.save(requests.create({
        householdId: invitation.visit.householdId,
        visitId: invitation.visitId,
        invitationId: invitation.id,
        menuItemId: item.id,
        mealDate: item.menu.date,
        mealType: item.menu.mealType,
        dishName: item.dish.name,
        note: null,
        status: 'pending',
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      }));
      await manager.getRepository(Notification).save(manager.getRepository(Notification).create({
        householdId: invitation.visit.householdId,
        recipientId: invitation.visit.hostMemberId,
        module: 'guest',
        type: 'guest_menu_selection',
        sourceId: saved.id,
        title: '访客选择了菜单菜品',
        body: `${invitation.guest.name} 选择了${item.dish.name}`,
        targetPath: `/guests?visitId=${invitation.visitId}`,
        readAt: null,
      }));
      return profileGuestMealRequest(saved);
    });
    // 访客公开页没有登录用户，拦截器不知道是哪家；事务提交后在这里发（见 contracts EVENT_ROUTES）
    if (householdId) this.events.publish({ householdId, domains: ['guests'] });
    return result;
  }

  async submitMealRequest(token: string, dto: GuestMealRequestDto) {
    let householdId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      householdId = invitation.visit.householdId;
      assertMealRequestsAllowed(invitation);
      const mealDate = dateOnly(dto.mealDate, '点菜日期');
      if (!visitMealDates(invitation.visit).includes(mealDate)) {
        throw new BadRequestException('点菜日期不在本次来访期间');
      }
      const dishName = dto.dishName.trim();
      if (!dishName) throw new BadRequestException('想吃的菜不能为空');
      const requests = manager.getRepository(GuestMealRequest);
      let request = await requests
        .createQueryBuilder('request')
        .where('request.invitationId = :invitationId', { invitationId: invitation.id })
        .andWhere('request.mealDate = :mealDate', { mealDate })
        .andWhere('request.mealType = :mealType', { mealType: dto.mealType })
        .setLock('pessimistic_write')
        .getOne();
      if (request?.status && request.status !== 'pending') {
        throw new ConflictException('这条点菜请求已被处理，无法再修改');
      }
      const isNew = !request;
      if (!request) {
        request = requests.create({
          householdId: invitation.visit.householdId,
          visitId: invitation.visitId,
          invitationId: invitation.id,
          mealDate,
          mealType: dto.mealType,
          dishName,
          note: dto.note?.trim() || null,
          status: 'pending',
          reviewNote: null,
          reviewedById: null,
          reviewedAt: null,
        });
      } else {
        request.dishName = dishName;
        request.note = dto.note?.trim() || null;
      }
      const saved = await requests.save(request);
      if (isNew) {
        await manager.getRepository(Notification).save(
          manager.getRepository(Notification).create({
            householdId: invitation.visit.householdId,
            recipientId: invitation.visit.hostMemberId,
            module: 'guest',
            type: 'guest_meal_request',
            sourceId: saved.id,
            title: '访客提交点菜请求',
            body: `${invitation.guest.name} 希望在${mealDate}的${mealLabel(dto.mealType)}吃${dishName}`,
            targetPath: `/guests?visitId=${invitation.visitId}`,
            readAt: null,
          }),
        );
      }
      return profileGuestMealRequest(saved);
    });
    // 访客公开页没有登录用户，拦截器不知道是哪家；事务提交后在这里发（见 contracts EVENT_ROUTES）
    if (householdId) this.events.publish({ householdId, domains: ['guests'] });
    return result;
  }

  async voteMoviePoll(token: string, pollId: string, dto: GuestPollVoteDto) {
    let householdId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      householdId = invitation.visit.householdId;
      assertMovieVotingAllowed(invitation);
      const poll = await manager
        .getRepository(Poll)
        .createQueryBuilder('poll')
        .where('poll.id = :pollId', { pollId })
        .andWhere('poll.householdId = :householdId', { householdId: invitation.visit.householdId })
        .andWhere('poll.category = :category', { category: 'movie' })
        .andWhere('poll.status = :status', { status: 'open' })
        .andWhere('poll.isArchived = false')
        .setLock('pessimistic_write')
        .getOne();
      if (!poll || (poll.closesAt && poll.closesAt.getTime() <= Date.now())) {
        throw new NotFoundException('可参与的观影投票不存在或已结束');
      }
      const optionIds = [...new Set(dto.optionIds)];
      if (optionIds.length > poll.maxChoices) {
        throw new BadRequestException(`最多选择 ${poll.maxChoices} 项`);
      }
      if (poll.voteMode === 'single' && optionIds.length > 1) {
        throw new BadRequestException('这是单选投票');
      }
      const options = await manager.getRepository(PollOption).findBy({ pollId: poll.id });
      const validIds = new Set(options.map((option) => option.id));
      if (optionIds.some((optionId) => !validIds.has(optionId))) {
        throw new NotFoundException('候选项不属于这个投票');
      }
      const votes = manager.getRepository(GuestPollVote);
      await votes.delete({ invitationId: invitation.id, pollId: poll.id });
      if (optionIds.length) {
        await votes.save(
          optionIds.map((optionId) =>
            votes.create({
              householdId: invitation.visit.householdId,
              invitationId: invitation.id,
              pollId: poll.id,
              optionId,
            }),
          ),
        );
      }
      const refreshed = await manager.getRepository(Poll).findOne({
        where: { id: poll.id },
        relations: { options: { media: { mediaTitle: true }, votes: true, guestVotes: true } },
        order: { options: { sortOrder: 'ASC' } },
      });
      if (!refreshed) throw new NotFoundException('观影投票不存在');
      return publicMoviePollProfile(refreshed, optionIds);
    });
    // 访客公开页没有登录用户，拦截器不知道是哪家；事务提交后在这里发（见 contracts EVENT_ROUTES）
    if (householdId) this.events.publish({ householdId, domains: ['guests', 'media', 'polls'] });
    return result;
  }

  private async activeInvitation(token: string, manager?: DataSource['manager']) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new NotFoundException('邀请不存在或已失效');
    const repository = (manager ?? this.dataSource.manager).getRepository(GuestInvitation);
    const presented = Buffer.from(hashToken(token), 'utf8');
    const invitation = await repository
      .createQueryBuilder('invitation')
      .addSelect('invitation.tokenHash')
      .innerJoinAndSelect('invitation.visit', 'visit')
      .innerJoinAndSelect('invitation.guest', 'guest')
      .innerJoinAndSelect('visit.household', 'household')
      .leftJoinAndSelect('visit.guestWifiProfile', 'guestWifiProfile')
      .addSelect('guestWifiProfile.passwordEncrypted')
      .where('invitation.tokenHash = :tokenHash', { tokenHash: presented.toString('utf8') })
      .getOne();
    const stored = invitation ? Buffer.from(invitation.tokenHash, 'utf8') : null;
    if (
      !invitation ||
      !stored ||
      stored.length !== presented.length ||
      !timingSafeEqual(stored, presented) ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.visit.status !== 'scheduled'
    ) {
      throw new NotFoundException('邀请不存在或已失效');
    }
    return invitation;
  }
}
