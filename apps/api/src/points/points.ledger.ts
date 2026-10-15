import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  HouseholdTaskInstance,
  PointsAccount,
  PointsLedger,
  PointsLedgerSourceType,
  PointsLedgerType,
} from '../entities';
import { normalizedText } from '@family/shared';

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

export async function applyDelta(manager: EntityManager, input: DeltaInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new BadRequestException('积分变化必须是非零整数');
  }
  await lockIdempotency(
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

export async function reverseEntry(
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
  return applyDelta(manager, {
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

/**
 * 任务实例上的积分版本 / 流水 id 两列由积分维护（列在任务实例表上，J1b 不动表）。任务那边已在同一事务里锁住并保存了这一行；
 * 不带 eager 关系重读，和原来直接传进来的那份对象一样。
 */
export function lockedTaskInstance(manager: EntityManager, payload: { instanceId: string; householdId: string }) {
  return manager
    .getRepository(HouseholdTaskInstance)
    .createQueryBuilder('instance')
    .where('instance.id = :id AND instance.householdId = :householdId', {
      id: payload.instanceId,
      householdId: payload.householdId,
    })
    .getOneOrFail();
}

export function lockIdempotency(
  manager: EntityManager,
  householdId: string,
  key: string,
) {
  return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${householdId}:${key}`,
  ]);
}
