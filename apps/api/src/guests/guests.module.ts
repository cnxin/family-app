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
import {
  Guest,
  GuestInvitation,
  Member,
  Notification,
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
}

class GuestResponseDto {
  @IsBoolean()
  attending: boolean;
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
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
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

  async listVisits(user: JwtUser, status?: VisitStatus) {
    const visits = await this.visits.find({
      where: { householdId: user.householdId, ...(status ? { status } : {}) },
      relations: { hostMember: true, guests: { guest: true } },
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
    const [host, guests] = await Promise.all([
      this.findActiveMember(dto.hostMemberId ?? user.memberId, user),
      this.guests.findBy({ id: In(guestIds), householdId: user.householdId, isActive: true }),
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
      expiresAt: invitation.expiresAt,
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

  private async findVisit(id: string, householdId: string, manager = this.dataSource.manager) {
    const visit = await manager.getRepository(Visit).findOne({
      where: { id, householdId },
      relations: { hostMember: true, guests: { guest: true } },
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
}

@Module({
  imports: [TypeOrmModule.forFeature([Guest, Visit, VisitGuest, GuestInvitation, Member, Notification])],
  controllers: [GuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
