import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';
import { addDays } from '@family/shared';
import { CREDIT_NOTICE_DAYS, nextMonthlyDayOnOrAfter, RECURRING_NOTICE_DAYS } from './finance-recurring.schedule';

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
 * K3：没开自动记账的周期账单，到期前 3 天到当天进留意，过了还没点「已付」的标逾期（和资产续费一样）。
 * 不设能力门槛：成员也能点「已付」。
 */
@Injectable()
export class FinanceRecurringDueProvider implements AttentionSource {
  readonly domain = 'finance' as const;
  readonly kinds = ['recurring'] as const;

  constructor(private readonly db: DataSource) {}

  run({ householdId, today }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'finance' AS domain, 'recurring' AS kind,
             r.id, r.title AS name,
             r."nextDueOn"::text AS "dueOn", r."nextDueOn" < $2::date AS overdue
        FROM finance_recurring r
       WHERE r."householdId" = $1
         AND r."isActive"
         AND NOT r."autoPost"
         AND r."nextDueOn" <= $2::date + $3::int`,
      [householdId, today, RECURRING_NOTICE_DAYS],
    );
  }
}

/**
 * K4：信用卡还款日（每月几号，短月按月末）前 3 天到当天，而且还欠着钱（余额为负）。名字里带上欠多少，
 * 标题模板是「{name} {soon}到还款日」。还款就是转账，成员也能记，不设能力门槛；过了还款日就看下个月的，不标逾期。
 */
@Injectable()
export class FinanceCreditDueProvider implements AttentionSource {
  readonly domain = 'finance' as const;
  readonly kinds = ['credit'] as const;

  constructor(private readonly db: DataSource) {}

  async run({ householdId, today }: AttentionRuleContext) {
    const cards: { id: string; name: string; dueDay: number; balance: string }[] = await this.db.query(
      `SELECT a.id, a.name, a."dueDay", a."openingBalance" + COALESCE(SUM(p.delta), 0) AS balance
         FROM finance_accounts a
         LEFT JOIN finance_postings p ON p."accountId" = a.id
        WHERE a."householdId" = $1
          AND a."isActive"
          AND a.type = 'credit'
          AND a."dueDay" IS NOT NULL
        GROUP BY a.id
        ORDER BY a."createdAt", a.id`,
      [householdId],
    );
    const horizon = addDays(today, CREDIT_NOTICE_DAYS);
    return cards.flatMap((card): AttentionCandidate[] => {
      const debt = Math.round(-Number(card.balance) * 100) / 100;
      if (!(debt > 0)) return [];
      const dueOn = nextMonthlyDayOnOrAfter(today, card.dueDay);
      if (dueOn > horizon) return [];
      const owed = debt.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return [{ domain: 'finance', kind: 'credit', id: card.id, name: `${card.name}（欠 ¥${owed}）`, dueOn, overdue: false }];
    });
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
    private readonly financeRecurring: FinanceRecurringDueProvider,
    private readonly financeCredit: FinanceCreditDueProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.financeBudget);
    this.registry.register(this.financeRecurring);
    this.registry.register(this.financeCredit);
  }
}
