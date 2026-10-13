import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { AuthSession, Member } from '../entities';
import { JwtUser } from './jwt.guard';
import { UpdateManagedMemberDto, UpdateManagedMemberStatusDto } from './auth.dto';
import { memberProfile, MEMBER_ROLE_LABELS } from './auth.shared';

function managedMemberProfile(member: Member) {
  return {
    ...memberProfile(member),
    account: member.account
      ? {
          loginName: member.account.loginName,
          disabledAt: member.account.disabledAt,
        }
      : null,
  };
}

@Injectable()
export class MemberManagementService {
  constructor(
    @InjectRepository(Member) private readonly members: Repository<Member>,
    private readonly dataSource: DataSource,
  ) {}

  async list(user: JwtUser) {
    const members = await this.members
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.account', 'account')
      .where('member.householdId = :householdId', {
        householdId: user.householdId,
      })
      .orderBy('member.disabledAt', 'ASC', 'NULLS FIRST')
      .addOrderBy('member.createdAt', 'ASC')
      .getMany();
    return members.map(managedMemberProfile);
  }

  async update(id: string, dto: UpdateManagedMemberDto, user: JwtUser) {
    const hasChanges = ['name', 'avatarEmoji', 'role', 'prefersCooking'].some(
      (key) => Object.prototype.hasOwnProperty.call(dto, key),
    );
    if (!hasChanges) throw new BadRequestException('没有需要更新的成员资料');

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `member-management:${user.householdId}`,
      ]);
      const members = manager.getRepository(Member);
      await this.assertActorStillAuthorized(members, user);
      const target = await members
        .createQueryBuilder('member')
        .where('member.id = :id', { id })
        .andWhere('member.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) throw new NotFoundException('成员不存在');
      this.assertCanManageTarget(user, target);

      const originalName = target.name;
      const changes: string[] = [];
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('成员名称不能为空');
        if (name !== target.name) {
          changes.push(`名称：${target.name} → ${name}`);
          target.name = name;
        }
      }
      if (dto.avatarEmoji !== undefined) {
        const avatarEmoji = dto.avatarEmoji.trim();
        if (!avatarEmoji) throw new BadRequestException('成员头像不能为空');
        if (avatarEmoji !== target.avatarEmoji) {
          changes.push('更新头像');
          target.avatarEmoji = avatarEmoji;
        }
      }
      if (
        dto.prefersCooking !== undefined &&
        dto.prefersCooking !== target.prefersCooking
      ) {
        changes.push(dto.prefersCooking ? '标记为经常掌勺' : '取消经常掌勺标记');
        target.prefersCooking = dto.prefersCooking;
      }
      if (dto.role !== undefined && dto.role !== target.role) {
        if (target.id === user.memberId) {
          throw new ForbiddenException('不能修改自己的家庭角色');
        }
        if (dto.role === 'owner' && user.role !== 'owner') {
          throw new ForbiddenException('只有家庭管理员可以授予管理员身份');
        }
        if (target.role === 'owner') {
          await this.assertAnotherActiveOwner(members, target);
        }
        changes.push(
          `角色：${MEMBER_ROLE_LABELS[target.role]} → ${MEMBER_ROLE_LABELS[dto.role]}`,
        );
        target.role = dto.role;
      }

      if (!changes.length) return;
      await members.save(target);
      if (dto.role !== undefined && changes.some((item) => item.startsWith('角色：'))) {
        await manager
          .getRepository(AuthSession)
          .createQueryBuilder()
          .update(AuthSession)
          .set({ revokedAt: new Date() })
          .where('"memberId" = :memberId', { memberId: target.id })
          .andWhere('"householdId" = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('"revokedAt" IS NULL')
          .execute();
      }
      await recordActivity(manager, user, {
        module: 'member',
        action: 'member_profile_updated',
        summary: `${user.name} 更新了 ${originalName} 的成员资料`,
        detail: changes.join('；'),
        subjectMemberId: target.id,
        targetPath: `/members?memberId=${target.id}`,
      });
    });
    return this.findManagedMember(id, user.householdId);
  }

  async setStatus(
    id: string,
    dto: UpdateManagedMemberStatusDto,
    user: JwtUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `member-management:${user.householdId}`,
      ]);
      const members = manager.getRepository(Member);
      await this.assertActorStillAuthorized(members, user);
      const target = await members
        .createQueryBuilder('member')
        .where('member.id = :id', { id })
        .andWhere('member.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!target) throw new NotFoundException('成员不存在');
      this.assertCanManageTarget(user, target);
      if (target.id === user.memberId) {
        throw new ForbiddenException('不能停用自己的家庭身份');
      }

      const currentlyEnabled = !target.disabledAt;
      if (currentlyEnabled === dto.enabled) return;
      if (!dto.enabled && target.role === 'owner') {
        await this.assertAnotherActiveOwner(members, target);
      }

      target.disabledAt = dto.enabled ? null : new Date();
      await members.save(target);
      if (!dto.enabled) {
        await manager
          .getRepository(AuthSession)
          .createQueryBuilder()
          .update(AuthSession)
          .set({ revokedAt: new Date() })
          .where('"memberId" = :memberId', { memberId: target.id })
          .andWhere('"householdId" = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('"revokedAt" IS NULL')
          .execute();
      }
      await recordActivity(manager, user, {
        module: 'member',
        action: dto.enabled ? 'member_enabled' : 'member_disabled',
        summary: `${user.name}${dto.enabled ? '恢复了' : '停用了'} ${target.name} 的家庭访问`,
        subjectMemberId: target.id,
        targetPath: `/members?memberId=${target.id}`,
      });
    });
    return this.findManagedMember(id, user.householdId);
  }

  private assertCanManageTarget(user: JwtUser, target: Member) {
    if (target.role === 'owner' && user.role !== 'owner') {
      throw new ForbiddenException('协管成员不能管理家庭管理员');
    }
  }

  private async assertActorStillAuthorized(
    members: Repository<Member>,
    user: JwtUser,
  ) {
    const actor = await members.findOneBy({
      id: user.memberId,
      householdId: user.householdId,
      disabledAt: IsNull(),
    });
    if (!actor || actor.role !== user.role || actor.role === 'member') {
      throw new UnauthorizedException('成员权限已更新，请重新登录');
    }
  }

  private async assertAnotherActiveOwner(
    members: Repository<Member>,
    target: Member,
  ) {
    const activeOwners = await members.countBy({
      householdId: target.householdId,
      role: 'owner',
      disabledAt: IsNull(),
    });
    if (activeOwners <= 1) {
      throw new ConflictException('请先指定另一位家庭管理员');
    }
  }

  private async findManagedMember(id: string, householdId: string) {
    const member = await this.members
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.account', 'account')
      .where('member.id = :id', { id })
      .andWhere('member.householdId = :householdId', { householdId })
      .getOne();
    if (!member) throw new NotFoundException('成员不存在');
    return managedMemberProfile(member);
  }
}
