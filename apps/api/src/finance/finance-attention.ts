import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 财务的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class FinanceBudgetAttentionRule implements AttentionSource {
  readonly domain = 'finance' as const;
  readonly kinds = ['budget'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId, month }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'finance' AS domain, 'budget' AS kind,
             b.id, COALESCE(c.name, '预算') AS name,
             NULL::text AS "dueOn", false AS overdue
        FROM finance_budgets b
        LEFT JOIN finance_categories c
          ON c.id = b."categoryId" AND c."householdId" = b."householdId"
       WHERE b."householdId" = $1
         AND b.month = $2
         AND b.amount < COALESCE((
           SELECT SUM(t.amount)
             FROM finance_transactions t
            WHERE t."householdId" = b."householdId"
              AND t."categoryId" = b."categoryId"
              AND t.type = 'expense'
              AND t."occurredOn" >= $3::date
              AND t."occurredOn" < $4::date
              AND NOT EXISTS (
                SELECT 1
                  FROM finance_transactions reversal
                 WHERE reversal."householdId" = t."householdId"
                   AND reversal."reversalOfId" = t.id
              )
         ), 0)`,
      [householdId, month.start.slice(0, 7), month.start, month.end],
    );
  }
}

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class FinanceAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly financeBudget: FinanceBudgetAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.financeBudget);
  }
}
