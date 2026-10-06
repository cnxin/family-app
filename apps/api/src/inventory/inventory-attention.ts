import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';

// 库存的留意规则（J1.7 从 today/today-attention.rules.ts 原样搬来，规则体不动）。
// 排序、模块开关归属、能力门槛、文案与落点都在 manifest 的 attention 里声明，今天页按声明统一判。

@Injectable()
export class InventoryExpiryAttentionRule implements AttentionSource {
  readonly domain = 'inventory' as const;
  readonly kinds = ['expiry'] as const;

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

/**
 * 把本域的留意规则挂到今天页的 AttentionRegistry。
 */
@Injectable()
export class InventoryAttention implements OnModuleInit {
  constructor(
    private readonly registry: AttentionRegistry,
    private readonly inventoryExpiry: InventoryExpiryAttentionRule,
  ) {}

  onModuleInit() {
    this.registry.register(this.inventoryExpiry);
  }
}
