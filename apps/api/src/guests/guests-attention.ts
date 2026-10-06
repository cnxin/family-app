import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 访客的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class GuestMenuAttentionRule implements AttentionSource {
  readonly domain = 'guests' as const;
  readonly kinds = ['menu'] as const;

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
export class GuestMealRequestAttentionRule implements AttentionSource {
  readonly domain = 'guests' as const;
  readonly kinds = ['meal-request'] as const;

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

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 * 同一个域里条件相同时，合并卡取先到的那条（种类、实体），所以按原来的顺序注册。
 */
@Injectable()
export class GuestsAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly guestMenu: GuestMenuAttentionRule,
    private readonly guestMealRequest: GuestMealRequestAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.guestMenu);
    this.registry.register(this.guestMealRequest);
  }
}
