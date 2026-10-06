import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 积分的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class PointsRedemptionAttentionRule implements AttentionSource {
  readonly domain = 'points' as const;
  readonly kinds = ['redemption'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'points' AS domain, 'redemption' AS kind,
             r.id, r."rewardName" AS name, NULL::text AS "dueOn", false AS overdue
        FROM reward_redemptions r
       WHERE r."householdId" = $1
         AND r.status = 'pending'`,
      [householdId],
    );
  }
}

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class PointsAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly pointsRedemption: PointsRedemptionAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.pointsRedemption);
  }
}
