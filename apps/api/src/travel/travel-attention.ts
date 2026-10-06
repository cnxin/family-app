import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 出行的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class TravelChecklistAttentionRule implements AttentionSource {
  readonly domain = 'travel' as const;
  readonly kinds = ['checklist'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'travel' AS domain, 'checklist' AS kind,
             p.id, p.title AS name, p."startDate"::text AS "dueOn",
             p."startDate" < $2::date AS overdue
        FROM travel_plans p
       WHERE p."householdId" = $1
         AND p.status = 'planned'
         AND p."archivedAt" IS NULL
         AND p."startDate" <= $3::date
         AND EXISTS (
           SELECT 1
             FROM travel_checklist_items i
            WHERE i."householdId" = p."householdId"
              AND i."planId" = p.id
              AND i.status = 'pending'
              AND i."archivedAt" IS NULL
         )`,
      [householdId, today, horizons.travel],
    );
  }
}

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class TravelAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly travelChecklist: TravelChecklistAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.travelChecklist);
  }
}
