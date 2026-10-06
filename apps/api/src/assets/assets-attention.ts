import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 资产的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class AssetMaintenanceAttentionRule implements AttentionSource {
  readonly domain = 'assets' as const;
  readonly kinds = ['maintenance'] as const;

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
export class AssetRenewalAttentionRule implements AttentionSource {
  readonly domain = 'assets' as const;
  readonly kinds = ['renewal'] as const;

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
export class AssetWarrantyAttentionRule implements AttentionSource {
  readonly domain = 'assets' as const;
  readonly kinds = ['warranty'] as const;

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

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 * 同一个域里条件相同时，合并卡取先到的那条（种类、实体），所以按原来的顺序注册。
 */
@Injectable()
export class AssetsAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly assetMaintenance: AssetMaintenanceAttentionRule,
    private readonly assetRenewal: AssetRenewalAttentionRule,
    private readonly assetWarranty: AssetWarrantyAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.assetMaintenance);
    this.registry.register(this.assetRenewal);
    this.registry.register(this.assetWarranty);
  }
}
