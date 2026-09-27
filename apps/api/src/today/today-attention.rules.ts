import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AttentionItem } from '@family/contracts';

export const ATTENTION_THRESHOLDS = {
  maintenanceDays: 7,
  renewalDays: 3,
  warrantyDays: 30,
  guestDays: 7,
  travelDays: 7,
  inventoryDays: 3,
  backupWorkerOfflineSeconds: 90,
} as const;

export type AttentionRuleContext = {
  householdId: string;
  memberId: string;
  timezone: string;
  now: Date;
  today: string;
  horizons: {
    maintenance: string;
    renewal: string;
    warranty: string;
    guests: string;
    travel: string;
    inventory: string;
  };
  month: { start: string; end: string };
};

export type AttentionCandidate = {
  domain: AttentionItem['domain'];
  kind: string;
  id: string;
  name: string;
  dueOn?: string;
  overdue: boolean;
};

export interface AttentionRule {
  run(context: AttentionRuleContext): Promise<AttentionCandidate[]>;
}

@Injectable()
export class AssetMaintenanceAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'assets' AS domain, 'maintenance' AS kind,
             p."assetId" AS id, a.name, p."nextDueDate"::text AS "dueOn",
             p."nextDueDate" < $2::date AS overdue
        FROM maintenance_plans p
        JOIN home_assets a ON a.id = p."assetId" AND a."householdId" = p."householdId"
       WHERE p."householdId" = $1
         AND p."isEnabled" = true
         AND a.status = 'active'
         AND p."nextDueDate" <= $3::date`,
      [householdId, today, horizons.maintenance],
    );
  }
}

@Injectable()
export class AssetRenewalAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'assets' AS domain, 'renewal' AS kind, a.id, a.name,
             a."renewsOn"::text AS "dueOn", a."renewsOn" < $2::date AS overdue
        FROM home_assets a
       WHERE a."householdId" = $1
         AND a.status = 'active'
         AND a."renewsOn" IS NOT NULL
         AND a."renewsOn" <= $3::date`,
      [householdId, today, horizons.renewal],
    );
  }
}

@Injectable()
export class AssetWarrantyAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'assets' AS domain, 'warranty' AS kind, a.id, a.name,
             a."warrantyExpiresOn"::text AS "dueOn",
             a."warrantyExpiresOn" < $2::date AS overdue
        FROM home_assets a
       WHERE a."householdId" = $1
         AND a.status = 'active'
         AND a."warrantyExpiresOn" IS NOT NULL
         AND a."warrantyExpiresOn" <= $3::date`,
      [householdId, today, horizons.warranty],
    );
  }
}

@Injectable()
export class GuestMenuAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons, timezone }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'guests' AS domain, 'menu' AS kind, v.id, v.title AS name,
             (v."startsAt" AT TIME ZONE $3)::date::text AS "dueOn",
             (v."startsAt" AT TIME ZONE $3)::date < $2::date AS overdue
        FROM visits v
       WHERE v."householdId" = $1
         AND v.status = 'scheduled'
         AND (v."startsAt" AT TIME ZONE $3)::date <= $4::date
         AND NOT EXISTS (
           SELECT 1
             FROM menus m
             JOIN menu_items mi ON mi."menuId" = m.id
            WHERE m."householdId" = v."householdId"
              AND m.date = (v."startsAt" AT TIME ZONE $3)::date
         )`,
      [householdId, today, timezone, horizons.guests],
    );
  }
}

@Injectable()
export class GuestMealRequestAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'guests' AS domain, 'meal-request' AS kind,
             r.id, r."dishName" AS name, NULL::text AS "dueOn", false AS overdue
        FROM guest_meal_requests r
       WHERE r."householdId" = $1
         AND r.status = 'pending'`,
      [householdId],
    );
  }
}

@Injectable()
export class TravelChecklistAttentionRule implements AttentionRule {
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

@Injectable()
export class InventoryExpiryAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, today, horizons }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'inventory' AS domain, 'expiry' AS kind,
             b.id, i.name, b."expiresOn"::text AS "dueOn",
             b."expiresOn" < $2::date AS overdue
        FROM inventory_batches b
        JOIN inventory_items i ON i.id = b."inventoryItemId"
                              AND i."householdId" = b."householdId"
       WHERE b."householdId" = $1
         AND b.quantity > 0
         AND b."expiresOn" IS NOT NULL
         AND b."expiresOn" <= $3::date`,
      [householdId, today, horizons.inventory],
    );
  }
}

@Injectable()
export class PollAttentionRule implements AttentionRule {
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

@Injectable()
export class PointsRedemptionAttentionRule implements AttentionRule {
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

@Injectable()
export class FinanceBudgetAttentionRule implements AttentionRule {
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

@Injectable()
export class BackupAttentionRule implements AttentionRule {
  constructor(private readonly db: DataSource) {}

  run({ householdId, now }: AttentionRuleContext) {
    return this.db.query<AttentionCandidate[]>(`
      SELECT 'backups' AS domain, 'backup' AS kind,
             p.id, '备份' AS name, NULL::text AS "dueOn", false AS overdue
        FROM backup_policies p
       WHERE p."householdId" = $1
         AND (
           (
             SELECT r.status
               FROM backup_runs r
              WHERE r."householdId" = p."householdId"
                AND r.kind = 'backup'
              ORDER BY r."createdAt" DESC
              LIMIT 1
           ) = 'failed'
           OR p."workerLastSeenAt" IS NULL
           OR p."workerLastSeenAt" < $2::timestamptz - interval '${ATTENTION_THRESHOLDS.backupWorkerOfflineSeconds} seconds'
         )`,
      [householdId, now],
    );
  }
}

// 智能家居留意规则在 E 阶段接入；本阶段不查询或生成 smart-home 条目。
