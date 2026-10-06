import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 投票的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class PollAttentionRule implements AttentionSource {
  readonly domain = 'polls' as const;
  readonly kinds = ['vote'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId, memberId, now }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'polls' AS domain, 'vote' AS kind,
             p.id, p.title AS name, NULL::text AS "dueOn", false AS overdue
        FROM polls p
       WHERE p."householdId" = $1
         AND p.status = 'open'
         AND p."isArchived" = false
         AND (p."closesAt" IS NULL OR p."closesAt" > $3::timestamptz)
         AND NOT EXISTS (
           SELECT 1
             FROM poll_votes v
            WHERE v."householdId" = p."householdId"
              AND v."pollId" = p.id
              AND v."memberId" = $2
         )`,
      [householdId, memberId, now],
    );
  }
}

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class PollsAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly poll: PollAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.poll);
  }
}
