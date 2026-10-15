import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThan, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  Guest,
  GuestInvitation,
  GuestMealRequest,
  GuestWifiProfile,
  HouseholdActivityLog,
  Member,
  Visit,
  VisitGuest,
  VisitStatus,
} from '../entities';
import {
  CreateGuestDto,
  UpdateGuestDto,
  CreateVisitDto,
  UpdateVisitDto,
  ReviewGuestMealRequestDto,
} from './guests.dto';
import {
  date,
  validRange,
  profileGuest,
  profileGuestMealRequest,
  profileVisit,
} from './guests.helpers';

@Injectable()
export class GuestsService {
  constructor(
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(GuestInvitation)
    private readonly invitations: Repository<GuestInvitation>,
    @InjectRepository(GuestMealRequest)
    private readonly guestMealRequests: Repository<GuestMealRequest>,
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
    if (guest.anonymizedAt) throw new ConflictException('已匿名化的访客不能再编辑或启用');
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

  async anonymizeGuest(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const guests = manager.getRepository(Guest);
      const guest = await guests.findOneBy({ id, householdId: user.householdId });
      if (!guest) throw new NotFoundException('访客不存在');
      if (guest.anonymizedAt) return profileGuest(guest);
      const scheduledVisitCount = await manager.getRepository(VisitGuest)
        .createQueryBuilder('visitGuest')
        .innerJoin('visitGuest.visit', 'visit')
        .where('visitGuest.guestId = :guestId', { guestId: guest.id })
        .andWhere('visit.householdId = :householdId', { householdId: user.householdId })
        .andWhere('visit.status = :status', { status: 'scheduled' })
        .getCount();
      if (scheduledVisitCount) {
        throw new ConflictException('该访客仍有已安排的来访，请结束或取消后再匿名化');
      }
      const now = new Date();
      guest.name = '已匿名访客';
      guest.avatarEmoji = '👤';
      guest.note = null;
      guest.isActive = false;
      guest.anonymizedAt = now;
      const saved = await guests.save(guest);
      await manager.getRepository(GuestInvitation).update(
        { guestId: guest.id, revokedAt: IsNull(), expiresAt: MoreThan(now) },
        { revokedAt: now },
      );
      await manager.getRepository(HouseholdActivityLog)
        .createQueryBuilder()
        .update(HouseholdActivityLog)
        .set({
          summary: '已匿名化的访客资料',
          detail: null,
          metadata: { anonymizedGuest: true },
        })
        .where('"householdId" = :householdId', { householdId: user.householdId })
        .andWhere('metadata @> :guestMetadata', { guestMetadata: JSON.stringify({ guestId: guest.id }) })
        .execute();
      await recordActivity(manager, user, {
        module: 'guest',
        action: 'guest_anonymized',
        summary: `${user.name} 匿名化了一位访客资料`,
        targetPath: '/guests',
        metadata: { anonymizedGuest: true },
      });
      return profileGuest(saved);
    });
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
    const mealRequestRows = visits.length
      ? await this.guestMealRequests.find({
          where: { householdId: user.householdId, visitId: In(visits.map((visit) => visit.id)) },
          relations: { invitation: { guest: true } },
          order: { mealDate: 'ASC', mealType: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const grouped = new Map<string, GuestInvitation[]>();
    for (const invitation of invitationRows) {
      grouped.set(invitation.visitId, [...(grouped.get(invitation.visitId) ?? []), invitation]);
    }
    const requestsByVisit = new Map<string, GuestMealRequest[]>();
    for (const request of mealRequestRows) {
      requestsByVisit.set(request.visitId, [...(requestsByVisit.get(request.visitId) ?? []), request]);
    }
    return visits.map((visit) => profileVisit(visit, grouped.get(visit.id) ?? [], requestsByVisit.get(visit.id) ?? []));
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

  async reviewMealRequest(id: string, dto: ReviewGuestMealRequestDto, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.getRepository(GuestMealRequest).findOne({
        where: { id, householdId: user.householdId },
        relations: { invitation: { guest: true }, visit: true },
      });
      if (!request) throw new NotFoundException('访客点菜请求不存在');
      request.status = dto.status;
      request.reviewNote = dto.reviewNote?.trim() || null;
      request.reviewedById = user.memberId;
      request.reviewedAt = new Date();
      const saved = await manager.getRepository(GuestMealRequest).save(request);
      await recordActivity(manager, user, {
        module: 'guest',
        action: `guest_meal_request_${dto.status}`,
        summary: `${user.name}${dto.status === 'accepted' ? '接受了' : '婉拒了'} ${request.invitation.guest.name} 的点菜请求`,
        targetPath: `/guests?visitId=${request.visitId}`,
        metadata: { guestMealRequestId: request.id, visitId: request.visitId, status: dto.status },
      });
      return profileGuestMealRequest(saved);
    });
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

  async findVisit(id: string, householdId: string, manager = this.dataSource.manager) {
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
    const mealRequests = await manager.getRepository(GuestMealRequest).find({
      where: { householdId, visitId: id },
      relations: { invitation: { guest: true } },
      order: { mealDate: 'ASC', mealType: 'ASC', createdAt: 'ASC' },
    });
    return profileVisit(visit, invitations, mealRequests);
  }
}
