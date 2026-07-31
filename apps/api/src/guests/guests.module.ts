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
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, In, IsNull, MoreThan, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { RequireCapabilities } from '../auth/capabilities';
import { decryptIntegrationCredential, encryptIntegrationCredential } from '../common/integration-credentials';
import {
  Guest,
  GuestInvitation,
  GuestPollVote,
  GuestWifiProfile,
  GuestWifiSecurity,
  Member,
  Notification,
  Poll,
  PollOption,
  Visit,
  VisitGuest,
  VisitStatus,
} from '../entities';

class CreateGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;
}

class UpdateGuestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CreateVisitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  hostMemberId?: string;

  @IsOptional()
  @IsUUID()
  guestWifiProfileId?: string | null;

  @IsArray()
  @IsUUID('4', { each: true })
  guestIds: string[];
}

class UpdateVisitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  hostMemberId?: string;

  @IsOptional()
  @IsUUID()
  guestWifiProfileId?: string | null;

  @IsOptional()
  @IsIn(['scheduled', 'cancelled', 'completed'])
  status?: VisitStatus;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guestIds?: string[];
}

class CreateGuestInvitationDto {
  @IsUUID()
  guestId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;

  @IsOptional()
  @IsBoolean()
  allowsMovieVoting?: boolean;
}

class GuestResponseDto {
  @IsBoolean()
  attending: boolean;
}

class GuestPollVoteDto {
  @IsArray()
  @IsUUID('4', { each: true })
  optionIds: string[];
}

class CreateGuestWifiProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  ssid: string;

  @IsIn(['WPA', 'nopass'])
  security: GuestWifiSecurity;

  @IsOptional()
  @IsString()
  @MaxLength(63)
  password?: string | null;
}

class UpdateGuestWifiProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  ssid?: string;

  @IsOptional()
  @IsIn(['WPA', 'nopass'])
  security?: GuestWifiSecurity;

  @IsOptional()
  @IsString()
  @MaxLength(63)
  password?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function date(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${field}无效`);
  return result;
}

function validRange(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('结束时间必须晚于开始时间');
  }
}

function profileGuest(guest: Guest) {
  return {
    id: guest.id,
    name: guest.name,
    avatarEmoji: guest.avatarEmoji,
    note: guest.note,
    isActive: guest.isActive,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
  };
}

function invitationProfile(invitation: GuestInvitation) {
  return {
    id: invitation.id,
    guestId: invitation.guestId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    allowsMovieVoting: invitation.allowsMovieVoting,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

function profileGuestWifi(profile: GuestWifiProfile) {
  return {
    id: profile.id,
    name: profile.name,
    ssid: profile.ssid,
    security: profile.security,
    passwordConfigured: profile.security === 'WPA' && profile.passwordEncrypted !== null,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function profileVisit(visit: Visit, invitations: GuestInvitation[]) {
  const invitationsByGuest = new Map(invitations.map((entry) => [entry.guestId, entry]));
  return {
    id: visit.id,
    title: visit.title,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    note: visit.note,
    status: visit.status,
    guestWifiProfile: visit.guestWifiProfile ? profileGuestWifi(visit.guestWifiProfile) : null,
    hostMember: visit.hostMember
      ? {
          id: visit.hostMember.id,
          name: visit.hostMember.name,
          avatarEmoji: visit.hostMember.avatarEmoji,
        }
      : null,
    guests: (visit.guests ?? []).map((entry) => ({
      id: entry.id,
      guest: profileGuest(entry.guest),
      isAttending: entry.isAttending,
      respondedAt: entry.respondedAt,
      invitation: invitationsByGuest.has(entry.guestId)
        ? invitationProfile(invitationsByGuest.get(entry.guestId)!)
        : null,
    })),
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

@Injectable()
export class GuestsService {
  constructor(
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(VisitGuest)
    private readonly visitGuests: Repository<VisitGuest>,
    @InjectRepository(GuestInvitation)
    private readonly invitations: Repository<GuestInvitation>,
    @InjectRepository(GuestWifiProfile)
    private readonly guestWifiProfiles: Repository<GuestWifiProfile>,
    @InjectRepository(Poll) private readonly polls: Repository<Poll>,
    @InjectRepository(PollOption) private readonly pollOptions: Repository<PollOption>,
    @InjectRepository(GuestPollVote)
    private readonly guestPollVotes: Repository<GuestPollVote>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly dataSource: DataSource,
  ) {}

  async listGuests(user: JwtUser) {
    const guests = await this.guests.find({
      where: { householdId: user.householdId },
      order: { isActive: 'DESC', name: 'ASC' },
    });
    return guests.map(profileGuest);
  }

  async createGuest(dto: CreateGuestDto, user: JwtUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('访客姓名不能为空');
    const guest = await this.guests.save(
      this.guests.create({
        householdId: user.householdId,
        name,
        avatarEmoji: dto.avatarEmoji?.trim() || '👋',
        note: dto.note?.trim() || null,
        isActive: true,
      }),
    );
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: 'guest_created',
        summary: `${user.name} 新增了访客 ${guest.name}`,
        targetPath: '/guests',
        metadata: { guestId: guest.id },
      }),
    );
    return profileGuest(guest);
  }

  async updateGuest(id: string, dto: UpdateGuestDto, user: JwtUser) {
    if (!Object.keys(dto).length) throw new BadRequestException('至少需要修改一个字段');
    const guest = await this.guests.findOneBy({ id, householdId: user.householdId });
    if (!guest) throw new NotFoundException('访客不存在');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('访客姓名不能为空');
      guest.name = name;
    }
    if (dto.avatarEmoji !== undefined) guest.avatarEmoji = dto.avatarEmoji.trim() || '👋';
    if (dto.note !== undefined) guest.note = dto.note?.trim() || null;
    if (dto.isActive !== undefined) guest.isActive = dto.isActive;
    const saved = await this.guests.save(guest);
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: saved.isActive ? 'guest_updated' : 'guest_archived',
        summary: `${user.name} 更新了访客 ${saved.name}`,
        targetPath: '/guests',
        metadata: { guestId: saved.id },
      }),
    );
    return profileGuest(saved);
  }

  async listGuestWifiProfiles(user: JwtUser) {
    const profiles = await this.guestWifiProfiles.find({
      where: { householdId: user.householdId },
      order: { isActive: 'DESC', updatedAt: 'DESC' },
    });
    return profiles.map(profileGuestWifi);
  }

  async createGuestWifiProfile(dto: CreateGuestWifiProfileDto, user: JwtUser) {
    const name = dto.name.trim();
    const ssid = dto.ssid.trim();
    if (!name) throw new BadRequestException('配置名称不能为空');
    if (!ssid) throw new BadRequestException('Wi-Fi 名称不能为空');
    const password = this.validateWifiPassword(dto.security, dto.password);
    const profile = await this.guestWifiProfiles.save(
      this.guestWifiProfiles.create({
        householdId: user.householdId,
        name,
        ssid,
        security: dto.security,
        passwordEncrypted: password
          ? encryptIntegrationCredential(password, user.householdId, 'guest-wifi')
          : null,
        isActive: true,
      }),
    );
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: 'guest_wifi_profile_created',
        summary: `${user.name} 新增了访客 Wi-Fi 配置`,
        targetPath: '/guests',
        metadata: { guestWifiProfileId: profile.id },
      }),
    );
    return profileGuestWifi(profile);
  }

  async updateGuestWifiProfile(id: string, dto: UpdateGuestWifiProfileDto, user: JwtUser) {
    if (!Object.keys(dto).length) throw new BadRequestException('至少需要修改一个字段');
    const profile = await this.guestWifiProfiles
      .createQueryBuilder('guestWifiProfile')
      .addSelect('guestWifiProfile.passwordEncrypted')
      .where('guestWifiProfile.id = :id', { id })
      .andWhere('guestWifiProfile.householdId = :householdId', { householdId: user.householdId })
      .getOne();
    if (!profile) throw new NotFoundException('访客 Wi-Fi 配置不存在');
    const security = dto.security ?? profile.security;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('配置名称不能为空');
      profile.name = name;
    }
    if (dto.ssid !== undefined) {
      const ssid = dto.ssid.trim();
      if (!ssid) throw new BadRequestException('Wi-Fi 名称不能为空');
      profile.ssid = ssid;
    }
    profile.security = security;
    if (security === 'nopass') {
      if (dto.password && dto.password.trim()) throw new BadRequestException('开放网络不能设置密码');
      profile.passwordEncrypted = null;
    } else if (dto.password !== undefined) {
      const password = this.validateWifiPassword(security, dto.password);
      profile.passwordEncrypted = encryptIntegrationCredential(password!, user.householdId, 'guest-wifi');
    } else if (!profile.passwordEncrypted) {
      throw new BadRequestException('WPA 网络必须设置 8 到 63 位密码');
    }
    if (dto.isActive !== undefined) profile.isActive = dto.isActive;
    const saved = await this.guestWifiProfiles.save(profile);
    await this.dataSource.transaction((manager) =>
      recordActivity(manager, user, {
        module: 'guest',
        action: saved.isActive ? 'guest_wifi_profile_updated' : 'guest_wifi_profile_disabled',
        summary: `${user.name} 更新了访客 Wi-Fi 配置`,
        targetPath: '/guests',
        metadata: { guestWifiProfileId: saved.id },
      }),
    );
    return profileGuestWifi(saved);
  }

  async listVisits(user: JwtUser, status?: VisitStatus) {
    const visits = await this.visits.find({
      where: { householdId: user.householdId, ...(status ? { status } : {}) },
      relations: { hostMember: true, guestWifiProfile: true, guests: { guest: true } },
      order: { startsAt: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
    const invitationRows = visits.length
      ? await this.invitations.find({ where: { visitId: In(visits.map((visit) => visit.id)) } })
      : [];
    const grouped = new Map<string, GuestInvitation[]>();
    for (const invitation of invitationRows) {
      grouped.set(invitation.visitId, [...(grouped.get(invitation.visitId) ?? []), invitation]);
    }
    return visits.map((visit) => profileVisit(visit, grouped.get(visit.id) ?? []));
  }

  async createVisit(dto: CreateVisitDto, user: JwtUser) {
    const startsAt = date(dto.startsAt, '开始时间');
    const endsAt = dto.endsAt ? date(dto.endsAt, '结束时间') : null;
    validRange(startsAt, endsAt);
    const guestIds = [...new Set(dto.guestIds)];
    if (!guestIds.length) throw new BadRequestException('至少选择一位访客');
    const [host, guests, guestWifiProfile] = await Promise.all([
      this.findActiveMember(dto.hostMemberId ?? user.memberId, user),
      this.guests.findBy({ id: In(guestIds), householdId: user.householdId, isActive: true }),
      this.findActiveGuestWifiProfile(dto.guestWifiProfileId, user.householdId),
    ]);
    if (guests.length !== guestIds.length) throw new BadRequestException('包含不存在或已停用的访客');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('来访主题不能为空');
    return this.dataSource.transaction(async (manager) => {
      const visit = await manager.getRepository(Visit).save(
        manager.getRepository(Visit).create({
          householdId: user.householdId,
          title,
          startsAt,
          endsAt,
          note: dto.note?.trim() || null,
          status: 'scheduled',
          guestWifiProfileId: guestWifiProfile?.id ?? null,
          hostMemberId: host.id,
          createdById: user.memberId,
        }),
      );
      await manager.getRepository(VisitGuest).save(
        guestIds.map((guestId) => manager.getRepository(VisitGuest).create({ visitId: visit.id, guestId })),
      );
      await recordActivity(manager, user, {
        module: 'guest',
        action: 'visit_created',
        summary: `${user.name} 安排了「${visit.title}」`,
        targetPath: `/guests?visitId=${visit.id}`,
        metadata: { visitId: visit.id, guestCount: guestIds.length },
      });
      return this.getVisit(visit.id, user.householdId, manager);
    });
  }

  async updateVisit(id: string, dto: UpdateVisitDto, user: JwtUser) {
    if (!Object.keys(dto).length) throw new BadRequestException('至少需要修改一个字段');
    return this.dataSource.transaction(async (manager) => {
      const visit = await this.findVisit(id, user.householdId, manager);
      const startsAt = dto.startsAt ? date(dto.startsAt, '开始时间') : visit.startsAt;
      const endsAt = dto.endsAt === undefined ? visit.endsAt : dto.endsAt ? date(dto.endsAt, '结束时间') : null;
      validRange(startsAt, endsAt);
      if (dto.title !== undefined) {
        const title = dto.title.trim();
        if (!title) throw new BadRequestException('来访主题不能为空');
        visit.title = title;
      }
      visit.startsAt = startsAt;
      visit.endsAt = endsAt;
      if (dto.note !== undefined) visit.note = dto.note?.trim() || null;
      if (dto.status !== undefined) visit.status = dto.status;
      if (dto.hostMemberId !== undefined) {
        visit.hostMemberId = (await this.findActiveMember(dto.hostMemberId, user)).id;
      }
      if (dto.guestWifiProfileId !== undefined) {
        visit.guestWifiProfileId = (
          await this.findActiveGuestWifiProfile(dto.guestWifiProfileId, user.householdId, manager)
        )?.id ?? null;
      }
      await manager.getRepository(Visit).save(visit);
      if (dto.guestIds !== undefined) {
        const guestIds = [...new Set(dto.guestIds)];
        if (!guestIds.length) throw new BadRequestException('至少选择一位访客');
        const guests = await manager.getRepository(Guest).findBy({ id: In(guestIds), householdId: user.householdId, isActive: true });
        if (guests.length !== guestIds.length) throw new BadRequestException('包含不存在或已停用的访客');
        await manager.getRepository(GuestInvitation).update({ visitId: visit.id }, { revokedAt: new Date() });
        await manager.getRepository(VisitGuest).delete({ visitId: visit.id });
        await manager.getRepository(VisitGuest).save(
          guestIds.map((guestId) => manager.getRepository(VisitGuest).create({ visitId: visit.id, guestId })),
        );
      }
      if (dto.status === 'cancelled') {
        await manager.getRepository(GuestInvitation).update({ visitId: visit.id }, { revokedAt: new Date() });
      }
      await recordActivity(manager, user, {
        module: 'guest',
        action: dto.status === 'cancelled' ? 'visit_cancelled' : 'visit_updated',
        summary: `${user.name} 更新了来访「${visit.title}」`,
        targetPath: `/guests?visitId=${visit.id}`,
        metadata: { visitId: visit.id, status: visit.status },
      });
      return this.getVisit(visit.id, user.householdId, manager);
    });
  }

  async createInvitation(visitId: string, dto: CreateGuestInvitationDto, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const visit = await this.findVisit(visitId, user.householdId, manager);
      if (visit.status !== 'scheduled') throw new ConflictException('只有进行中的来访可以创建邀请');
      const participant = await manager.getRepository(VisitGuest).findOneBy({ visitId, guestId: dto.guestId });
      if (!participant) throw new NotFoundException('该访客不在本次来访中');
      const now = new Date();
      await manager.getRepository(GuestInvitation).update(
        { visitId, guestId: dto.guestId, revokedAt: IsNull(), expiresAt: MoreThan(now) },
        { revokedAt: now },
      );
      const invitationToken = randomBytes(32).toString('base64url');
      const invitation = await manager.getRepository(GuestInvitation).save(
        manager.getRepository(GuestInvitation).create({
          visitId,
          guestId: dto.guestId,
          tokenHash: hashToken(invitationToken),
          expiresAt: new Date(now.getTime() + (dto.expiresInHours ?? 72) * 3_600_000),
          revokedAt: null,
          acceptedAt: null,
          allowsMovieVoting: dto.allowsMovieVoting ?? false,
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'guest',
        action: 'guest_invitation_created',
        summary: `${user.name} 创建了「${visit.title}」的访客邀请`,
        targetPath: `/guests?visitId=${visit.id}`,
        metadata: { visitId: visit.id, guestId: dto.guestId, invitationId: invitation.id },
      });
      return { ...invitationProfile(invitation), invitationToken };
    });
  }

  async revokeInvitation(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await manager.getRepository(GuestInvitation).findOne({
        where: { id },
        relations: { visit: true },
      });
      if (!invitation || invitation.visit.householdId !== user.householdId) {
        throw new NotFoundException('访客邀请不存在');
      }
      if (!invitation.revokedAt) {
        invitation.revokedAt = new Date();
        await manager.getRepository(GuestInvitation).save(invitation);
        await recordActivity(manager, user, {
          module: 'guest',
          action: 'guest_invitation_revoked',
          summary: `${user.name} 撤销了访客邀请`,
          targetPath: `/guests?visitId=${invitation.visitId}`,
          metadata: { visitId: invitation.visitId, invitationId: invitation.id },
        });
      }
      return { id, revoked: true as const };
    });
  }

  async publicInvitation(token: string) {
    const invitation = await this.activeInvitation(token);
    const participant = await this.visitGuests.findOneBy({
      visitId: invitation.visitId,
      guestId: invitation.guestId,
    });
    return this.publicProfile(invitation, participant);
  }

  async respond(token: string, dto: GuestResponseDto) {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      const participant = await manager.getRepository(VisitGuest).findOneBy({
        visitId: invitation.visitId,
        guestId: invitation.guestId,
      });
      if (!participant) throw new NotFoundException('来访参与关系不存在');
      if (participant.respondedAt) return this.publicProfile(invitation, participant);
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
      return this.publicProfile(invitation, participant);
    });
  }

  async publicMoviePolls(token: string) {
    const invitation = await this.activeInvitation(token);
    this.assertMovieVotingAllowed(invitation);
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
      .map((poll) => this.publicMoviePollProfile(poll, selectedByPoll.get(poll.id) ?? []));
  }

  async voteMoviePoll(token: string, pollId: string, dto: GuestPollVoteDto) {
    return this.dataSource.transaction(async (manager) => {
      const invitation = await this.activeInvitation(token, manager);
      this.assertMovieVotingAllowed(invitation);
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
      return this.publicMoviePollProfile(refreshed, optionIds);
    });
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

  private publicProfile(invitation: GuestInvitation, participant?: VisitGuest | null) {
    const guestWifiProfile = invitation.visit.guestWifiProfile;
    const wifi = guestWifiProfile?.isActive
      ? this.publicWifiProfile(guestWifiProfile, invitation.visit.householdId)
      : null;
    return {
      guest: { name: invitation.guest.name, avatarEmoji: invitation.guest.avatarEmoji },
      householdName: invitation.visit.household.name,
      visit: {
        title: invitation.visit.title,
        startsAt: invitation.visit.startsAt,
        endsAt: invitation.visit.endsAt,
        note: invitation.visit.note,
      },
      response: {
        attending: participant?.isAttending ?? null,
        respondedAt: participant?.respondedAt ?? null,
      },
      capabilities: { movieVoting: invitation.allowsMovieVoting },
      wifi,
      expiresAt: invitation.expiresAt,
    };
  }

  private publicWifiProfile(profile: GuestWifiProfile, householdId: string) {
    try {
      const password = profile.security === 'WPA'
        ? decryptIntegrationCredential(profile.passwordEncrypted, householdId, 'guest-wifi', '访客 Wi-Fi')
        : null;
      if (profile.security === 'WPA' && !password) return null;
      const escape = (value: string) => value.replace(/([\\\\;,:\"])/g, '\\\\$1');
      const qrPayload = profile.security === 'WPA'
        ? `WIFI:T:WPA;S:${escape(profile.ssid)};P:${escape(password!)};;`
        : `WIFI:T:nopass;S:${escape(profile.ssid)};;`;
      return { ssid: profile.ssid, security: profile.security, qrPayload };
    } catch {
      return null;
    }
  }

  private assertMovieVotingAllowed(invitation: GuestInvitation) {
    if (!invitation.allowsMovieVoting) {
      throw new NotFoundException('此邀请未开放观影投票');
    }
  }

  private publicMoviePollProfile(poll: Poll, selectedOptionIds: string[]) {
    const options = [...(poll.options ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
    const voterIds = new Set([
      ...options.flatMap((option) => option.votes.map((vote) => `member:${vote.memberId}`)),
      ...options.flatMap((option) => option.guestVotes.map((vote) => `guest:${vote.invitationId}`)),
    ]);
    return {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      voteMode: poll.voteMode,
      maxChoices: poll.maxChoices,
      closesAt: poll.closesAt,
      totalVoters: voterIds.size,
      selectedOptionIds,
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        voteCount: option.votes.length + option.guestVotes.length,
        media: option.media
          ? {
              title: option.media.mediaTitle.title,
              originalTitle: option.media.mediaTitle.originalTitle,
              year: option.media.mediaTitle.year,
              posterUrl: option.media.mediaTitle.posterUrl,
            }
          : null,
      })),
    };
  }

  private async findActiveMember(id: string, user: JwtUser) {
    const member = await this.members.findOneBy({
      id,
      householdId: user.householdId,
      disabledAt: IsNull(),
    });
    if (!member) throw new BadRequestException('接待成员不存在或已停用');
    return member;
  }

  private async findActiveGuestWifiProfile(
    id: string | null | undefined,
    householdId: string,
    manager = this.dataSource.manager,
  ) {
    if (id === undefined || id === null) return null;
    const profile = await manager
      .getRepository(GuestWifiProfile)
      .createQueryBuilder('guestWifiProfile')
      .addSelect('guestWifiProfile.passwordEncrypted')
      .where('guestWifiProfile.id = :id', { id })
      .andWhere('guestWifiProfile.householdId = :householdId', { householdId })
      .andWhere('guestWifiProfile.isActive = true')
      .getOne();
    if (!profile) throw new BadRequestException('访客 Wi-Fi 配置不存在、已停用或不属于当前家庭');
    if (profile.security === 'WPA' && !profile.passwordEncrypted) {
      throw new BadRequestException('访客 Wi-Fi 配置缺少密码');
    }
    return profile;
  }

  private validateWifiPassword(security: GuestWifiSecurity, provided: string | null | undefined) {
    if (security === 'nopass') {
      if (provided && provided.trim()) throw new BadRequestException('开放网络不能设置密码');
      return null;
    }
    const password = provided?.trim() ?? '';
    if (password.length < 8 || password.length > 63) {
      throw new BadRequestException('WPA 网络密码必须为 8 到 63 位');
    }
    return password;
  }

  private async findVisit(id: string, householdId: string, manager = this.dataSource.manager) {
    const visit = await manager.getRepository(Visit).findOne({
      where: { id, householdId },
      relations: { hostMember: true, guestWifiProfile: true, guests: { guest: true } },
    });
    if (!visit) throw new NotFoundException('来访计划不存在');
    return visit;
  }

  private async getVisit(id: string, householdId: string, manager = this.dataSource.manager) {
    const visit = await this.findVisit(id, householdId, manager);
    const invitations = await manager.getRepository(GuestInvitation).find({ where: { visitId: id } });
    return profileVisit(visit, invitations);
  }
}

@Controller()
export class GuestsController {
  constructor(private readonly service: GuestsService) {}

  @Get('guests')
  @RequireCapabilities('manage_guests')
  listGuests(@CurrentUser() user: JwtUser) {
    return this.service.listGuests(user);
  }

  @Post('guests')
  @RequireCapabilities('manage_guests')
  createGuest(@Body() dto: CreateGuestDto, @CurrentUser() user: JwtUser) {
    return this.service.createGuest(dto, user);
  }

  @Patch('guests/:id')
  @RequireCapabilities('manage_guests')
  updateGuest(@Param('id') id: string, @Body() dto: UpdateGuestDto, @CurrentUser() user: JwtUser) {
    return this.service.updateGuest(id, dto, user);
  }

  @Get('guest-wifi-profiles')
  @RequireCapabilities('manage_guests')
  listGuestWifiProfiles(@CurrentUser() user: JwtUser) {
    return this.service.listGuestWifiProfiles(user);
  }

  @Post('guest-wifi-profiles')
  @RequireCapabilities('manage_guests')
  createGuestWifiProfile(@Body() dto: CreateGuestWifiProfileDto, @CurrentUser() user: JwtUser) {
    return this.service.createGuestWifiProfile(dto, user);
  }

  @Patch('guest-wifi-profiles/:id')
  @RequireCapabilities('manage_guests')
  updateGuestWifiProfile(@Param('id') id: string, @Body() dto: UpdateGuestWifiProfileDto, @CurrentUser() user: JwtUser) {
    return this.service.updateGuestWifiProfile(id, dto, user);
  }

  @Get('visits')
  @RequireCapabilities('manage_guests')
  listVisits(@CurrentUser() user: JwtUser, @Query('status') status?: VisitStatus) {
    if (status && !['scheduled', 'cancelled', 'completed'].includes(status)) {
      throw new BadRequestException('来访状态无效');
    }
    return this.service.listVisits(user, status);
  }

  @Post('visits')
  @RequireCapabilities('manage_guests')
  createVisit(@Body() dto: CreateVisitDto, @CurrentUser() user: JwtUser) {
    return this.service.createVisit(dto, user);
  }

  @Patch('visits/:id')
  @RequireCapabilities('manage_guests')
  updateVisit(@Param('id') id: string, @Body() dto: UpdateVisitDto, @CurrentUser() user: JwtUser) {
    return this.service.updateVisit(id, dto, user);
  }

  @Post('visits/:id/invitations')
  @RequireCapabilities('manage_guests')
  createInvitation(@Param('id') id: string, @Body() dto: CreateGuestInvitationDto, @CurrentUser() user: JwtUser) {
    return this.service.createInvitation(id, dto, user);
  }

  @Delete('guest-invitations/:id')
  @RequireCapabilities('manage_guests')
  revokeInvitation(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.revokeInvitation(id, user);
  }

  @Public()
  @Get('guest-invitations/:token')
  publicInvitation(@Param('token') token: string) {
    return this.service.publicInvitation(token);
  }

  @Public()
  @Post('guest-invitations/:token/response')
  respond(@Param('token') token: string, @Body() dto: GuestResponseDto) {
    return this.service.respond(token, dto);
  }

  @Public()
  @Get('guest-invitations/:token/movie-polls')
  publicMoviePolls(@Param('token') token: string) {
    return this.service.publicMoviePolls(token);
  }

  @Public()
  @Post('guest-invitations/:token/movie-polls/:pollId/votes')
  voteMoviePoll(
    @Param('token') token: string,
    @Param('pollId') pollId: string,
    @Body() dto: GuestPollVoteDto,
  ) {
    return this.service.voteMoviePoll(token, pollId, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Guest, Visit, VisitGuest, GuestInvitation, GuestWifiProfile, GuestPollVote, Poll, PollOption, Member, Notification])],
  controllers: [GuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
