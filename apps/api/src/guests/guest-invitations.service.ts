import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { GuestInvitation, VisitGuest } from '../entities';
import { CreateGuestInvitationDto } from './guests.dto';
import { hashToken, invitationProfile } from './guests.helpers';
import { GuestsService } from './guests.service';

/** 访客邀请链接：生成与撤销（J7.2 从 GuestsService 拆出；凭链接访问的公开页见 GuestPortalService）。 */
@Injectable()
export class GuestInvitationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly guestsService: GuestsService,
  ) {}

  async createInvitation(visitId: string, dto: CreateGuestInvitationDto, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const visit = await this.guestsService.findVisit(visitId, user.householdId, manager);
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
          allowsMealRequests: dto.allowsMealRequests ?? false,
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
}
