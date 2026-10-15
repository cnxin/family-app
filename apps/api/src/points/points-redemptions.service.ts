import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  type DecideRedemptionBody,
  type LedgerOperationBody,
  type RedemptionQuery,
} from '@family/contracts';
import {
  Member,
  Notification,
  PointsLedger,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
} from '../entities';
import { isHouseholdManager, normalizedText } from '@family/shared';
import { applyDelta, reverseEntry, lockIdempotency } from './points.ledger';

async function lockRedemption(
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

function notifyRedemption(
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

/** 积分兑换：兑换、审批、取消与撤销，带幂等键（J7.2 从积分服务拆出）。 */
@Injectable()
export class PointsRedemptionsService {
  constructor(
    @InjectRepository(RewardRedemption)
    private readonly redemptions: Repository<RewardRedemption>,
    private readonly dataSource: DataSource,
  ) {}

  async redeem(rewardId: string, dto: LedgerOperationBody, user: JwtUser) {
    const redemptionId = await this.dataSource.transaction(async (manager) => {
      await lockIdempotency(
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
      const debit = await applyDelta(manager, {
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

  listRedemptions(query: RedemptionQuery, user: JwtUser) {
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

  async decide(id: string, dto: DecideRedemptionBody, user: JwtUser) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await lockIdempotency(
        manager,
        user.householdId,
        `redemption-resolution:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await lockRedemption(manager, id, user.householdId);
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
        const restore = await reverseEntry(
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
      await notifyRedemption(manager, redemption, user);
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

  async cancel(id: string, dto: LedgerOperationBody, user: JwtUser) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await lockIdempotency(
        manager,
        user.householdId,
        `redemption-cancel:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await lockRedemption(manager, id, user.householdId);
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
      const restore = await reverseEntry(
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
    dto: LedgerOperationBody,
    user: JwtUser,
  ) {
    const resultId = await this.dataSource.transaction(async (manager) => {
      await lockIdempotency(
        manager,
        user.householdId,
        `redemption-reverse:${dto.idempotencyKey}`,
      );
      const repository = manager.getRepository(RewardRedemption);
      const redemption = await lockRedemption(manager, id, user.householdId);
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
      const restore = await reverseEntry(
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
      await notifyRedemption(manager, redemption, user);
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

  private async findRedemption(id: string, householdId: string) {
    const redemption = await this.redemptions.findOneBy({ id, householdId });
    if (!redemption) throw new NotFoundException('兑换记录不存在');
    return redemption;
  }
}
