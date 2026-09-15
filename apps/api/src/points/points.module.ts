import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  HouseholdTask,
  HouseholdTaskInstance,
  Member,
  Notification,
  PointsAccount,
  PointsLedger,
  PointsLedgerSourceType,
  PointsLedgerType,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
} from '../entities';
import { isHouseholdManager, normalizedText } from '@family/shared';

class LedgerQueryDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class AdjustmentDto {
  @IsUUID()
  memberId: string;

  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsString()
  @MaxLength(180)
  idempotencyKey: string;
}

class ReverseLedgerDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsString()
  @MaxLength(180)
  idempotencyKey: string;
}

class CreateRewardDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  cost: number;
}

class UpdateRewardDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  cost?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class RedeemRewardDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsString()
  @MaxLength(180)
  idempotencyKey: string;
}

class RedemptionQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'cancelled', 'reversed'])
  status?: RewardRedemptionStatus;

  @IsOptional()
  @IsUUID()
  memberId?: string;
}

class DecideRedemptionDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsString()
  @MaxLength(180)
  idempotencyKey: string;
}

class RedemptionOperationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsString()
  @MaxLength(180)
  idempotencyKey: string;
}

interface DeltaInput {
  householdId: string;
  memberId: string;
  delta: number;
  type: PointsLedgerType;
  actor: JwtUser;
  sourceType: PointsLedgerSourceType;
  sourceId: string;
  idempotencyKey: string;
  note?: string | null;
  reversesLedgerId?: string | null;
}

@Injectable()
export class PointsService {
  constructor(
    @InjectRepository(PointsAccount)
    private readonly accounts: Repository<PointsAccount>,
    @InjectRepository(PointsLedger)
    private readonly ledger: Repository<PointsLedger>,
    @InjectRepository(Reward)
    private readonly rewards: Repository<Reward>,
    @InjectRepository(RewardRedemption)
    private readonly redemptions: Repository<RewardRedemption>,
    private readonly dataSource: DataSource,
  ) {}

  async listAccounts(user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const members = await manager.getRepository(Member).find({
        where: { householdId: user.householdId },
        order: { createdAt: 'ASC' },
      });
      for (const member of members) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(PointsAccount)
          .values({
            householdId: user.householdId,
            memberId: member.id,
            balance: 0,
          })
          .orIgnore()
          .execute();
      }
    });
    return this.accounts.find({
      where: { householdId: user.householdId },
      order: { balance: 'DESC', createdAt: 'ASC' },
    });
  }

  listLedger(query: LedgerQueryDto, user: JwtUser) {
    return this.ledger.find({
      where: {
        householdId: user.householdId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 100,
    });
  }

  async adjust(dto: AdjustmentDto, user: JwtUser) {
    if (dto.delta === 0) throw new BadRequestException('积分变化不能为 0');
    await this.requireMember(dto.memberId, user.householdId);
    const entry = await this.dataSource.transaction(async (manager) => {
      const saved = await this.applyDelta(manager, {
        householdId: user.householdId,
        memberId: dto.memberId,
        delta: dto.delta,
        type: dto.delta > 0 ? 'award' : 'adjustment',
        actor: user,
        sourceType: 'manual',
        sourceId: dto.memberId,
        idempotencyKey: dto.idempotencyKey,
        note: normalizedText(dto.note),
      });
      if (saved.created) {
        await recordActivity(manager, user, {
          module: 'points',
          action: dto.delta > 0 ? 'points_awarded' : 'points_adjusted',
          summary: `${user.name}${dto.delta > 0 ? '发放' : '扣减'}了 ${Math.abs(dto.delta)} 积分`,
          detail: normalizedText(dto.note),
          subjectMemberId: dto.memberId,
          targetPath: '/points',
          metadata: { ledgerId: saved.entry.id, delta: dto.delta },
        });
      }
      return saved.entry;
    });
    return this.findLedger(entry.id, user.householdId);
  }

  async reverseLedger(id: string, dto: ReverseLedgerDto, user: JwtUser) {
    const entry = await this.dataSource.transaction(async (manager) => {
      const original = await manager.getRepository(PointsLedger).findOneBy({
        id,
        householdId: user.householdId,
      });
      if (!original) throw new NotFoundException('积分流水不存在');
      if (original.sourceType !== 'manual') {
        throw new BadRequestException('任务和兑换积分必须通过原业务操作撤销');
      }
      const reversed = await this.reverseEntry(
        manager,
        original,
        user,
        dto.idempotencyKey,
        normalizedText(dto.note),
      );
      if (reversed.created) {
        await recordActivity(manager, user, {
          module: 'points',
          action: 'points_reversed',
          summary: `${user.name}撤销了一笔 ${Math.abs(original.delta)} 积分流水`,
          detail: normalizedText(dto.note),
          subjectMemberId: original.memberId,
          targetPath: '/points',
          metadata: {
            ledgerId: reversed.entry.id,
            reversesLedgerId: original.id,
          },
        });
      }
      return reversed.entry;
    });
    return this.findLedger(entry.id, user.householdId);
  }

  listRewards(includeInactive: boolean, user: JwtUser) {
    return this.rewards.find({
      where: {
        householdId: user.householdId,
        ...(!includeInactive || !isHouseholdManager(user) ? { isActive: true } : {}),
      },
      order: { isActive: 'DESC', cost: 'ASC', createdAt: 'ASC' },
    });
  }

  async createReward(dto: CreateRewardDto, user: JwtUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('奖励名称不能为空');
    const reward = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Reward);
      const duplicate = await repository.findOneBy({
        householdId: user.householdId,
        name,
      });
      if (duplicate) throw new ConflictException('家庭内已存在同名奖励');
      const saved = await repository.save(
        repository.create({
          householdId: user.householdId,
          name,
          description: normalizedText(dto.description),
          cost: dto.cost,
          isActive: true,
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'points',
        action: 'reward_created',
        summary: `${user.name}创建了奖励「${saved.name}」`,
        detail: `${saved.cost} 积分`,
        targetPath: '/points',
        metadata: { rewardId: saved.id, cost: saved.cost },
      });
      return saved;
    });
    return this.findReward(reward.id, user.householdId);
  }

  async updateReward(id: string, dto: UpdateRewardDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Reward);
      const reward = await repository
        .createQueryBuilder('reward')
        .where('reward.id = :id', { id })
        .andWhere('reward.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!reward) throw new NotFoundException('家庭奖励不存在');
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('奖励名称不能为空');
        const duplicate = await repository
          .createQueryBuilder('other')
          .where('other.householdId = :householdId', {
            householdId: user.householdId,
          })
          .andWhere('other.name = :name', { name })
          .andWhere('other.id <> :id', { id })
          .getOne();
        if (duplicate) throw new ConflictException('家庭内已存在同名奖励');
        reward.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
        reward.description = normalizedText(dto.description);
      }
      if (dto.cost !== undefined) reward.cost = dto.cost;
      if (dto.isActive !== undefined) reward.isActive = dto.isActive;
      await repository.save(reward);
      await recordActivity(manager, user, {
        module: 'points',
        action: 'reward_updated',
        summary: `${user.name}更新了奖励「${reward.name}」`,
        detail: reward.isActive ? `${reward.cost} 积分` : '已停用',
        targetPath: '/points',
        metadata: {
          rewardId: reward.id,
          cost: reward.cost,
          isActive: reward.isActive,
        },
      });
    });
    return this.findReward(id, user.householdId);
  }

  async redeem(rewardId: string, dto: RedeemRewardDto, user: JwtUser) {
    const redemptionId = await this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(
        manager,
        user.householdId,
        `redemption:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const existing = await repository.findOneBy({
        householdId: user.householdId,
        requestIdempotencyKey: dto.idempotencyKey,
      });
      if (existing) {
        if (existing.memberId !== user.memberId || existing.rewardId !== rewardId) {
          throw new ConflictException('幂等键已用于另一笔兑换');
        }
        return existing.id;
      }
      const reward = await manager.getRepository(Reward).findOneBy({
        id: rewardId,
        householdId: user.householdId,
        isActive: true,
      });
      if (!reward) throw new NotFoundException('可兑换奖励不存在');
      const id = randomUUID();
      const debit = await this.applyDelta(manager, {
        householdId: user.householdId,
        memberId: user.memberId,
        delta: -reward.cost,
        type: 'redemption',
        actor: user,
        sourceType: 'reward_redemption',
        sourceId: id,
        idempotencyKey: `redemption-debit:${dto.idempotencyKey}`,
        note: `兑换「${reward.name}」`,
      });
      await repository.save(
        repository.create({
          id,
          householdId: user.householdId,
          rewardId: reward.id,
          memberId: user.memberId,
          rewardName: reward.name,
          cost: reward.cost,
          status: 'pending',
          requestNote: normalizedText(dto.note),
          requestIdempotencyKey: dto.idempotencyKey,
          debitLedgerId: debit.entry.id,
          handledById: null,
          handledAt: null,
          decisionNote: null,
          resolutionIdempotencyKey: null,
          restoreLedgerId: null,
          reversedById: null,
          reversedAt: null,
          reversalNote: null,
          reversalIdempotencyKey: null,
        }),
      );
      await recordActivity(manager, user, {
        module: 'points',
        action: 'reward_redeemed',
        summary: `${user.name}申请兑换「${reward.name}」`,
        detail: `${reward.cost} 积分已扣除，等待确认`,
        subjectMemberId: user.memberId,
        targetPath: `/points?redemptionId=${id}`,
        metadata: { rewardId: reward.id, redemptionId: id, cost: reward.cost },
      });
      return id;
    });
    return this.findRedemption(redemptionId, user.householdId);
  }

  listRedemptions(query: RedemptionQueryDto, user: JwtUser) {
    const memberId = isHouseholdManager(user) ? query.memberId : user.memberId;
    return this.redemptions.find({
      where: {
        householdId: user.householdId,
        ...(memberId ? { memberId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async decide(id: string, dto: DecideRedemptionDto, user: JwtUser) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(
        manager,
        user.householdId,
        `redemption-resolution:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await this.lockRedemption(manager, id, user.householdId);
      if (redemption.resolutionIdempotencyKey === dto.idempotencyKey) {
        const sameDecision =
          (dto.decision === 'approve' && redemption.status === 'approved') ||
          (dto.decision === 'reject' && redemption.status === 'rejected');
        if (!sameDecision) throw new ConflictException('幂等键对应的处理结果不一致');
        return redemption.id;
      }
      if (redemption.status !== 'pending') {
        throw new ConflictException('这笔兑换已处理，不能重复审批');
      }
      let restoreLedgerId: string | null = null;
      if (dto.decision === 'reject') {
        const original = await manager.getRepository(PointsLedger).findOneByOrFail({
          id: redemption.debitLedgerId,
          householdId: user.householdId,
        });
        const restore = await this.reverseEntry(
          manager,
          original,
          user,
          `redemption-reject:${dto.idempotencyKey}`,
          `拒绝兑换「${redemption.rewardName}」并退回积分`,
        );
        restoreLedgerId = restore.entry.id;
      }
      redemption.status = dto.decision === 'approve' ? 'approved' : 'rejected';
      redemption.handledById = user.memberId;
      redemption.handledAt = new Date();
      redemption.decisionNote = normalizedText(dto.note);
      redemption.resolutionIdempotencyKey = dto.idempotencyKey;
      redemption.restoreLedgerId = restoreLedgerId;
      await repository.save(redemption);
      await this.notifyRedemption(manager, redemption, user);
      await recordActivity(manager, user, {
        module: 'points',
        action:
          dto.decision === 'approve'
            ? 'redemption_approved'
            : 'redemption_rejected',
        summary: `${user.name}${dto.decision === 'approve' ? '确认' : '拒绝'}了 ${redemption.member.name} 的兑换`,
        detail: `「${redemption.rewardName}」 · ${redemption.cost} 积分`,
        subjectMemberId: redemption.memberId,
        targetPath: `/points?redemptionId=${redemption.id}`,
        metadata: { redemptionId: redemption.id, status: redemption.status },
      });
      return redemption.id;
    });
    return this.findRedemption(resultId, user.householdId);
  }

  async cancel(id: string, dto: RedemptionOperationDto, user: JwtUser) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(
        manager,
        user.householdId,
        `redemption-cancel:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await this.lockRedemption(manager, id, user.householdId);
      if (redemption.memberId !== user.memberId) {
        throw new NotFoundException('兑换记录不存在');
      }
      if (
        redemption.status === 'cancelled' &&
        redemption.resolutionIdempotencyKey === dto.idempotencyKey
      ) {
        return redemption.id;
      }
      if (redemption.status !== 'pending') {
        throw new ConflictException('只有待确认兑换可以取消');
      }
      const original = await manager.getRepository(PointsLedger).findOneByOrFail({
        id: redemption.debitLedgerId,
        householdId: user.householdId,
      });
      const restore = await this.reverseEntry(
        manager,
        original,
        user,
        `redemption-cancel:${dto.idempotencyKey}`,
        `取消兑换「${redemption.rewardName}」并退回积分`,
      );
      redemption.status = 'cancelled';
      redemption.handledById = user.memberId;
      redemption.handledAt = new Date();
      redemption.decisionNote = normalizedText(dto.note);
      redemption.resolutionIdempotencyKey = dto.idempotencyKey;
      redemption.restoreLedgerId = restore.entry.id;
      await repository.save(redemption);
      await recordActivity(manager, user, {
        module: 'points',
        action: 'redemption_cancelled',
        summary: `${user.name}取消了兑换「${redemption.rewardName}」`,
        detail: `${redemption.cost} 积分已退回`,
        subjectMemberId: redemption.memberId,
        targetPath: `/points?redemptionId=${redemption.id}`,
        metadata: { redemptionId: redemption.id },
      });
      return redemption.id;
    });
    return this.findRedemption(resultId, user.householdId);
  }

  async reverseRedemption(
    id: string,
    dto: RedemptionOperationDto,
    user: JwtUser,
  ) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(
        manager,
        user.householdId,
        `redemption-reverse:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await this.lockRedemption(manager, id, user.householdId);
      if (
        redemption.status === 'reversed' &&
        redemption.reversalIdempotencyKey === dto.idempotencyKey
      ) {
        return redemption.id;
      }
      if (redemption.status !== 'approved') {
        throw new ConflictException('只有已确认兑换可以撤销');
      }
      const original = await manager.getRepository(PointsLedger).findOneByOrFail({
        id: redemption.debitLedgerId,
        householdId: user.householdId,
      });
      const restore = await this.reverseEntry(
        manager,
        original,
        user,
        `redemption-reverse:${dto.idempotencyKey}`,
        `撤销兑换「${redemption.rewardName}」并退回积分`,
      );
      redemption.status = 'reversed';
      redemption.restoreLedgerId = restore.entry.id;
      redemption.reversedById = user.memberId;
      redemption.reversedAt = new Date();
      redemption.reversalNote = normalizedText(dto.note);
      redemption.reversalIdempotencyKey = dto.idempotencyKey;
      await repository.save(redemption);
      await this.notifyRedemption(manager, redemption, user);
      await recordActivity(manager, user, {
        module: 'points',
        action: 'redemption_reversed',
        summary: `${user.name}撤销了 ${redemption.member.name} 的兑换`,
        detail: `「${redemption.rewardName}」 · ${redemption.cost} 积分已退回`,
        subjectMemberId: redemption.memberId,
        targetPath: `/points?redemptionId=${redemption.id}`,
        metadata: { redemptionId: redemption.id },
      });
      return redemption.id;
    });
    return this.findRedemption(resultId, user.householdId);
  }

  async awardTaskCompletion(
    manager: EntityManager,
    task: HouseholdTask,
    instance: HouseholdTaskInstance,
    memberId: string,
    user: JwtUser,
  ) {
    if (task.rewardPoints <= 0) return null;
    const version = instance.pointsAwardVersion + 1;
    const result = await this.applyDelta(manager, {
      householdId: user.householdId,
      memberId,
      delta: task.rewardPoints,
      type: 'award',
      actor: user,
      sourceType: 'task',
      sourceId: `${task.id}:${instance.dueDate}`,
      idempotencyKey: `task:${instance.id}:award:${version}`,
      note: `完成任务「${task.title}」`,
    });
    instance.pointsAwardVersion = version;
    instance.pointsLedgerId = result.entry.id;
    await manager.getRepository(HouseholdTaskInstance).save(instance);
    await recordActivity(manager, user, {
      module: 'points',
      action: 'task_points_awarded',
      summary: `完成「${task.title}」获得 ${task.rewardPoints} 积分`,
      subjectMemberId: memberId,
      targetPath: `/tasks?date=${instance.dueDate}&taskId=${task.id}`,
      metadata: { taskId: task.id, ledgerId: result.entry.id },
    });
    return result.entry;
  }

  async reverseTaskAward(
    manager: EntityManager,
    task: HouseholdTask,
    instance: HouseholdTaskInstance,
    user: JwtUser,
  ) {
    if (!instance.pointsLedgerId) return null;
    const original = await manager.getRepository(PointsLedger).findOneByOrFail({
      id: instance.pointsLedgerId,
      householdId: user.householdId,
    });
    const result = await this.reverseEntry(
      manager,
      original,
      user,
      `task:${instance.id}:reverse:${instance.pointsAwardVersion}`,
      `恢复任务「${task.title}」并撤销积分`,
    );
    instance.pointsLedgerId = null;
    await manager.getRepository(HouseholdTaskInstance).save(instance);
    await recordActivity(manager, user, {
      module: 'points',
      action: 'task_points_reversed',
      summary: `恢复「${task.title}」并撤销 ${task.rewardPoints} 积分`,
      subjectMemberId: original.memberId,
      targetPath: `/tasks?date=${instance.dueDate}&taskId=${task.id}`,
      metadata: { taskId: task.id, ledgerId: result.entry.id },
    });
    return result.entry;
  }

  private async applyDelta(manager: EntityManager, input: DeltaInput) {
    if (!Number.isInteger(input.delta) || input.delta === 0) {
      throw new BadRequestException('积分变化必须是非零整数');
    }
    await this.lockIdempotency(
      manager,
      input.householdId,
      `ledger:${input.idempotencyKey}`,
    );
    const ledger = manager.getRepository(PointsLedger);
    const existing = await ledger.findOneBy({
      householdId: input.householdId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (
        existing.memberId !== input.memberId ||
        existing.delta !== input.delta ||
        existing.type !== input.type ||
        existing.sourceType !== input.sourceType ||
        existing.sourceId !== input.sourceId ||
        existing.reversesLedgerId !== (input.reversesLedgerId ?? null)
      ) {
        throw new ConflictException('幂等键已用于另一笔积分变化');
      }
      return { entry: existing, created: false };
    }
    await manager
      .createQueryBuilder()
      .insert()
      .into(PointsAccount)
      .values({
        householdId: input.householdId,
        memberId: input.memberId,
        balance: 0,
      })
      .orIgnore()
      .execute();
    const account = await manager
      .getRepository(PointsAccount)
      .createQueryBuilder('account')
      .where('account.householdId = :householdId', {
        householdId: input.householdId,
      })
      .andWhere('account.memberId = :memberId', { memberId: input.memberId })
      .setLock('pessimistic_write')
      .getOneOrFail();
    const pointsAfter = account.balance + input.delta;
    if (pointsAfter < 0) throw new BadRequestException('可用积分不足');
    const entry = await ledger.save(
      ledger.create({
        householdId: input.householdId,
        accountId: account.id,
        memberId: input.memberId,
        type: input.type,
        pointsBefore: account.balance,
        delta: input.delta,
        pointsAfter,
        actorId: input.actor.memberId,
        actorName: input.actor.name,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        note: normalizedText(input.note),
        reversesLedgerId: input.reversesLedgerId ?? null,
      }),
    );
    account.balance = pointsAfter;
    await manager.getRepository(PointsAccount).save(account);
    return { entry, created: true };
  }

  private async reverseEntry(
    manager: EntityManager,
    original: PointsLedger,
    actor: JwtUser,
    idempotencyKey: string,
    note: string | null,
  ) {
    const existingReversal = await manager.getRepository(PointsLedger).findOneBy({
      householdId: original.householdId,
      reversesLedgerId: original.id,
    });
    if (existingReversal) {
      if (existingReversal.idempotencyKey !== idempotencyKey) {
        throw new ConflictException('这笔积分流水已经撤销');
      }
      return { entry: existingReversal, created: false };
    }
    return this.applyDelta(manager, {
      householdId: original.householdId,
      memberId: original.memberId,
      delta: -original.delta,
      type: 'reversal',
      actor,
      sourceType: 'points_ledger',
      sourceId: original.id,
      idempotencyKey,
      note,
      reversesLedgerId: original.id,
    });
  }

  private lockIdempotency(
    manager: EntityManager,
    householdId: string,
    key: string,
  ) {
    return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${householdId}:${key}`,
    ]);
  }

  private async lockRedemption(
    manager: EntityManager,
    id: string,
    householdId: string,
  ) {
    const redemption = await manager
      .getRepository(RewardRedemption)
      .createQueryBuilder('redemption')
      .where('redemption.id = :id', { id })
      .andWhere('redemption.householdId = :householdId', { householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!redemption) throw new NotFoundException('兑换记录不存在');
    redemption.member = await manager.getRepository(Member).findOneByOrFail({
      id: redemption.memberId,
      householdId,
    });
    return redemption;
  }

  private notifyRedemption(
    manager: EntityManager,
    redemption: RewardRedemption,
    actor: JwtUser,
  ) {
    const labels: Record<RewardRedemptionStatus, string> = {
      pending: '等待确认',
      approved: '已确认',
      rejected: '未通过，积分已退回',
      cancelled: '已取消',
      reversed: '已撤销，积分已退回',
    };
    const repository = manager.getRepository(Notification);
    return repository.save(
      repository.create({
        householdId: actor.householdId,
        recipientId: redemption.memberId,
        module: 'points',
        type: `redemption_${redemption.status}`,
        sourceId: redemption.id,
        title: `兑换「${redemption.rewardName}」${labels[redemption.status]}`.slice(
          0,
          160,
        ),
        body: `${redemption.cost} 积分`,
        targetPath: `/points?redemptionId=${redemption.id}`,
      }),
    );
  }

  private async requireMember(memberId: string, householdId: string) {
    const member = await this.dataSource.getRepository(Member).findOneBy({
      id: memberId,
      householdId,
    });
    if (!member) throw new NotFoundException('家庭成员不存在');
    return member;
  }

  private async findLedger(id: string, householdId: string) {
    const entry = await this.ledger.findOneBy({ id, householdId });
    if (!entry) throw new NotFoundException('积分流水不存在');
    return entry;
  }

  private async findReward(id: string, householdId: string) {
    const reward = await this.rewards.findOneBy({ id, householdId });
    if (!reward) throw new NotFoundException('家庭奖励不存在');
    return reward;
  }

  private async findRedemption(id: string, householdId: string) {
    const redemption = await this.redemptions.findOneBy({ id, householdId });
    if (!redemption) throw new NotFoundException('兑换记录不存在');
    return redemption;
  }
}

@Controller()
export class PointsController {
  constructor(private readonly service: PointsService) {}

  @Get('points/accounts')
  accounts(@CurrentUser() user: JwtUser) {
    return this.service.listAccounts(user);
  }

  @Get('points/ledger')
  ledger(@Query() query: LedgerQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.listLedger(query, user);
  }

  @Post('points/adjustments')
  @RequireCapabilities('manage_points')
  adjust(@Body() dto: AdjustmentDto, @CurrentUser() user: JwtUser) {
    return this.service.adjust(dto, user);
  }

  @Post('points/ledger/:id/reverse')
  @RequireCapabilities('manage_points')
  reverseLedger(
    @Param('id') id: string,
    @Body() dto: ReverseLedgerDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reverseLedger(id, dto, user);
  }

  @Get('rewards')
  rewards(
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listRewards(includeInactive === 'true', user);
  }

  @Post('rewards')
  @RequireCapabilities('manage_points')
  createReward(@Body() dto: CreateRewardDto, @CurrentUser() user: JwtUser) {
    return this.service.createReward(dto, user);
  }

  @Patch('rewards/:id')
  @RequireCapabilities('manage_points')
  updateReward(
    @Param('id') id: string,
    @Body() dto: UpdateRewardDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateReward(id, dto, user);
  }

  @Post('rewards/:id/redemptions')
  redeem(
    @Param('id') id: string,
    @Body() dto: RedeemRewardDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.redeem(id, dto, user);
  }

  @Get('reward-redemptions')
  redemptions(
    @Query() query: RedemptionQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listRedemptions(query, user);
  }

  @Post('reward-redemptions/:id/decision')
  @RequireCapabilities('manage_points')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideRedemptionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decide(id, dto, user);
  }

  @Post('reward-redemptions/:id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: RedemptionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.cancel(id, dto, user);
  }

  @Post('reward-redemptions/:id/reverse')
  @RequireCapabilities('manage_points')
  reverseRedemption(
    @Param('id') id: string,
    @Body() dto: RedemptionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reverseRedemption(id, dto, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Member,
      Notification,
      PointsAccount,
      PointsLedger,
      Reward,
      RewardRedemption,
    ]),
  ],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
