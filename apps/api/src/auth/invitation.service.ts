import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { hashPin, verifyPin } from '../common/pin';
import { Account, HouseholdInvitation, Member } from '../entities';
import { normalizeLoginName } from './account.credentials';
import { JwtUser } from './jwt.guard';
import { createInvitationToken, hashRefreshToken } from './session.tokens';
import { isUniqueViolation } from '@family/shared';
import { CreateInvitationDto, InvitationTokenDto, RedeemInvitationDto } from './auth.dto';
import { AuthService } from './auth.service';
import { AUTH_ACCOUNT_SELECT, MEMBER_ROLE_LABELS } from './auth.shared';

function invitationProfile(invitation: HouseholdInvitation) {
  return {
    id: invitation.id,
    memberName: invitation.memberName,
    avatarEmoji: invitation.avatarEmoji,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(HouseholdInvitation)
    private readonly invitations: Repository<HouseholdInvitation>,
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  async list(user: JwtUser) {
    const invitations = await this.invitations.find({
      where: {
        householdId: user.householdId,
        acceptedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
    return invitations.map(invitationProfile);
  }

  async create(user: JwtUser, dto: CreateInvitationDto) {
    const memberName = dto.memberName.trim();
    if (!memberName) throw new BadRequestException('成员名称不能为空');
    const invitationToken = createInvitationToken();
    const expiresAt = new Date(
      Date.now() + (dto.expiresInHours ?? 48) * 60 * 60 * 1000,
    );
    const invitation = await this.dataSource.transaction(async (manager) => {
      const invitations = manager.getRepository(HouseholdInvitation);
      const saved = await invitations.save(
        invitations.create({
          householdId: user.householdId,
          tokenHash: hashRefreshToken(invitationToken),
          memberName,
          avatarEmoji: dto.avatarEmoji?.trim() || '🙂',
          role: dto.role ?? 'member',
          invitedById: user.memberId,
          acceptedByAccountId: null,
          expiresAt,
          acceptedAt: null,
          revokedAt: null,
        }),
      );
      await recordActivity(manager, user, {
        module: 'invitation',
        action: 'invitation_created',
        summary: `${user.name} 邀请 ${memberName} 加入家庭`,
        detail: MEMBER_ROLE_LABELS[saved.role],
        targetPath: '/members',
        metadata: { invitationId: saved.id },
      });
      return saved;
    });
    return { ...invitationProfile(invitation), invitationToken };
  }

  async revoke(user: JwtUser, id: string) {
    const invitation = await this.dataSource.transaction(async (manager) => {
      const invitations = manager.getRepository(HouseholdInvitation);
      const target = await invitations
        .createQueryBuilder('invitation')
        .where('invitation.id = :id', { id })
        .andWhere('invitation.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) throw new NotFoundException('邀请不存在');
      if (target.acceptedAt) throw new ConflictException('邀请已经被领取');
      if (!target.revokedAt) {
        target.revokedAt = new Date();
        await invitations.save(target);
        await recordActivity(manager, user, {
          module: 'invitation',
          action: 'invitation_revoked',
          summary: `${user.name} 撤销了给 ${target.memberName} 的邀请`,
          targetPath: '/members',
          metadata: { invitationId: target.id },
        });
      }
      return target;
    });
    return invitationProfile(invitation);
  }

  async preview(dto: InvitationTokenDto) {
    const invitation = await this.findUsableInvitation(
      this.invitations,
      dto.invitationToken,
      false,
    );
    return {
      householdName: invitation.household.name,
      memberName: invitation.memberName,
      avatarEmoji: invitation.avatarEmoji,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  async redeem(dto: RedeemInvitationDto) {
    const loginName = dto.loginName.trim();
    const loginNameNormalized = normalizeLoginName(loginName);
    if (!loginNameNormalized) throw new BadRequestException('登录账号不能为空');

    let accepted: { account: Account; member: Member };
    try {
      accepted = await this.dataSource.transaction(async (manager) => {
        const invitation = await this.findUsableInvitation(
          manager.getRepository(HouseholdInvitation),
          dto.invitationToken,
          true,
        );
        const accounts = manager.getRepository(Account);
        let account = await accounts.findOne({
          where: { loginNameNormalized },
          select: AUTH_ACCOUNT_SELECT,
        });
        if (account) {
          if (
            account.disabledAt ||
            !account.passwordHash ||
            !(await verifyPin(dto.password, account.passwordHash))
          ) {
            throw new UnauthorizedException('账号或密码不正确');
          }
        } else {
          if (dto.password.length < 8) {
            throw new BadRequestException('新账号密码至少需要 8 位');
          }
          account = await accounts.save(
            accounts.create({
              loginName,
              loginNameNormalized,
              passwordHash: await hashPin(dto.password),
              disabledAt: null,
            }),
          );
        }

        const members = manager.getRepository(Member);
        if (
          await members.findOneBy({
            householdId: invitation.householdId,
            accountId: account.id,
          })
        ) {
          throw new ConflictException('该账号已经是这个家庭的成员');
        }
        const member = await members.save(
          members.create({
            householdId: invitation.householdId,
            accountId: account.id,
            name: invitation.memberName,
            avatarEmoji: invitation.avatarEmoji,
            role: invitation.role,
            prefersCooking: false,
          }),
        );
        invitation.acceptedAt = new Date();
        invitation.acceptedByAccountId = account.id;
        await manager.getRepository(HouseholdInvitation).save(invitation);
        await recordActivity(
          manager,
          {
            sub: account.id,
            accountId: account.id,
            memberId: member.id,
            householdId: member.householdId,
            sid: 'invitation-redemption',
            name: member.name,
            role: member.role,
          },
          {
            module: 'invitation',
            action: 'invitation_redeemed',
            summary: `${member.name} 加入了家庭`,
            subjectMemberId: member.id,
            targetPath: `/members?memberId=${member.id}`,
            metadata: { invitationId: invitation.id },
          },
        );
        return { account, member };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('登录账号已经被使用');
      }
      throw error;
    }
    return this.auth.startSession(accepted.account, accepted.member);
  }

  private async findUsableInvitation(
    repository: Repository<HouseholdInvitation>,
    invitationToken: string,
    lock: boolean,
  ) {
    let query = repository
      .createQueryBuilder('invitation')
      .innerJoinAndSelect('invitation.household', 'household')
      .where('invitation.tokenHash = :tokenHash', {
        tokenHash: hashRefreshToken(invitationToken),
      });
    if (lock) query = query.setLock('pessimistic_write');
    const invitation = await query.getOne();
    if (!invitation) throw new NotFoundException('邀请无效');
    if (invitation.acceptedAt) throw new GoneException('邀请已经被领取');
    if (invitation.revokedAt) throw new GoneException('邀请已经被撤销');
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('邀请已经过期');
    }
    return invitation;
  }
}
