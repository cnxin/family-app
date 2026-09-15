import { z } from 'zod';
import {
  idParams,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/points/points.module.ts 与 docs/m6-points-rewards-acceptance.md
// 积分使用不可变流水 + 行锁余额；所有写操作都要求 idempotencyKey。

export const POINTS_LEDGER_TYPES = [
  'award',
  'adjustment',
  'redemption',
  'reversal',
] as const;
export const pointsLedgerType = z.enum(POINTS_LEDGER_TYPES);
export type PointsLedgerType = z.infer<typeof pointsLedgerType>;

export const POINTS_LEDGER_SOURCE_TYPES = [
  'manual',
  'task',
  'reward_redemption',
  'points_ledger',
] as const;
export const pointsLedgerSourceType = z.enum(POINTS_LEDGER_SOURCE_TYPES);
export type PointsLedgerSourceType = z.infer<typeof pointsLedgerSourceType>;

export const REWARD_REDEMPTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'reversed',
] as const;
export const rewardRedemptionStatus = z.enum(REWARD_REDEMPTION_STATUSES);
export type RewardRedemptionStatus = z.infer<typeof rewardRedemptionStatus>;

/** 幂等键：客户端生成，服务端按 (household, key) 去重。 */
export const idempotencyKey = z.string().min(1).max(180);

export const pointsAccountSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    memberId: uuid,
    member: memberSchema,
    balance: z.number().int(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type PointsAccount = z.infer<typeof pointsAccountSchema>;

export const pointsLedgerSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    accountId: uuid,
    memberId: uuid,
    member: memberSchema,
    type: pointsLedgerType,
    pointsBefore: z.number().int(),
    delta: z.number().int(),
    pointsAfter: z.number().int(),
    actorId: uuid,
    actor: memberSchema,
    actorName: z.string(),
    sourceType: pointsLedgerSourceType,
    sourceId: z.string(),
    note: z.string().nullable(),
    reversesLedgerId: uuid.nullable(),
    createdAt: isoDateTime,
  })
  .loose();
export type PointsLedger = z.infer<typeof pointsLedgerSchema>;

export const rewardSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    description: z.string().nullable(),
    cost: z.number().int(),
    isActive: z.boolean(),
    createdById: uuid,
    createdBy: memberSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type Reward = z.infer<typeof rewardSchema>;

export const rewardRedemptionSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    rewardId: uuid,
    reward: rewardSchema,
    memberId: uuid,
    member: memberSchema,
    rewardName: z.string(),
    cost: z.number().int(),
    status: rewardRedemptionStatus,
    requestNote: z.string().nullable(),
    debitLedgerId: uuid,
    handledById: uuid.nullable(),
    handledBy: memberSchema.nullable(),
    handledAt: nullableDateTime,
    decisionNote: z.string().nullable(),
    restoreLedgerId: uuid.nullable(),
    reversedById: uuid.nullable(),
    reversedBy: memberSchema.nullable(),
    reversedAt: nullableDateTime,
    reversalNote: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type RewardRedemption = z.infer<typeof rewardRedemptionSchema>;

export const ledgerQuery = z.object({
  memberId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const adjustmentBody = z.object({
  memberId: uuid,
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  note: z.string().max(500).nullish(),
  idempotencyKey,
});
export type AdjustmentBody = z.infer<typeof adjustmentBody>;

/** 撤销流水、取消/撤销兑换共用：备注 + 幂等键。 */
export const ledgerOperationBody = z.object({
  note: z.string().max(500).nullish(),
  idempotencyKey,
});
export type LedgerOperationBody = z.infer<typeof ledgerOperationBody>;

export const createRewardBody = z.object({
  name: z.string().max(120),
  description: z.string().max(1000).nullish(),
  cost: z.number().int().min(1).max(1_000_000),
});
export type CreateRewardBody = z.infer<typeof createRewardBody>;

export const updateRewardBody = createRewardBody
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateRewardBody = z.infer<typeof updateRewardBody>;

export const rewardsQuery = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const redemptionQuery = z.object({
  status: rewardRedemptionStatus.optional(),
  memberId: uuid.optional(),
});

export const decideRedemptionBody = ledgerOperationBody.extend({
  decision: z.enum(['approve', 'reject']),
});
export type DecideRedemptionBody = z.infer<typeof decideRedemptionBody>;

export const points = {
  accounts: defineEndpoint({
    method: 'GET',
    path: '/points/accounts',
    summary: '列出家庭成员积分账户（首次访问自动补建）',
    response: z.array(pointsAccountSchema),
  }),
  ledger: defineEndpoint({
    method: 'GET',
    path: '/points/ledger',
    summary: '积分流水（最新在前）',
    query: ledgerQuery,
    response: z.array(pointsLedgerSchema),
  }),
  adjust: defineEndpoint({
    method: 'POST',
    path: '/points/adjustments',
    summary: '管理员手工调整积分',
    body: adjustmentBody,
    response: pointsLedgerSchema,
  }),
  reverseLedger: defineEndpoint({
    method: 'POST',
    path: '/points/ledger/:id/reverse',
    summary: '反向冲销一条流水',
    params: idParams,
    body: ledgerOperationBody,
    response: pointsLedgerSchema,
  }),
  rewards: defineEndpoint({
    method: 'GET',
    path: '/rewards',
    summary: '奖励目录（管理员可含停用项）',
    query: rewardsQuery,
    response: z.array(rewardSchema),
  }),
  createReward: defineEndpoint({
    method: 'POST',
    path: '/rewards',
    summary: '新建奖励',
    body: createRewardBody,
    response: rewardSchema,
  }),
  updateReward: defineEndpoint({
    method: 'PATCH',
    path: '/rewards/:id',
    summary: '修改或停用奖励',
    params: idParams,
    body: updateRewardBody,
    response: rewardSchema,
  }),
  redeem: defineEndpoint({
    method: 'POST',
    path: '/rewards/:id/redemptions',
    summary: '申请兑换（申请时即扣分）',
    params: idParams,
    body: ledgerOperationBody,
    response: rewardRedemptionSchema,
  }),
  redemptions: defineEndpoint({
    method: 'GET',
    path: '/reward-redemptions',
    summary: '兑换申请列表',
    query: redemptionQuery,
    response: z.array(rewardRedemptionSchema),
  }),
  decide: defineEndpoint({
    method: 'POST',
    path: '/reward-redemptions/:id/decision',
    summary: '管理员批准或拒绝兑换（拒绝时退分）',
    params: idParams,
    body: decideRedemptionBody,
    response: rewardRedemptionSchema,
  }),
  cancel: defineEndpoint({
    method: 'POST',
    path: '/reward-redemptions/:id/cancel',
    summary: '申请人取消待处理兑换（退分）',
    params: idParams,
    body: ledgerOperationBody,
    response: rewardRedemptionSchema,
  }),
  reverseRedemption: defineEndpoint({
    method: 'POST',
    path: '/reward-redemptions/:id/reverse',
    summary: '管理员撤销已批准的兑换（退分）',
    params: idParams,
    body: ledgerOperationBody,
    response: rewardRedemptionSchema,
  }),
};
