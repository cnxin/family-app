import { EntityManager } from 'typeorm';
import { FinanceMerchantRule } from '../entities';

/**
 * 记一条「商户 → 分类」（导入预览里改分类、K5 在流水里改分类都走这里）：pattern 是 normalizeMerchant 之后的商户名；
 * 同一家庭、同一商户、同一收支已有规则就换成这次的分类、hits +1。
 */
export async function learnMerchantRule(
  manager: EntityManager,
  rule: { householdId: string; pattern: string; kind: 'expense' | 'income'; categoryId: string },
) {
  await manager
    .createQueryBuilder()
    .insert()
    .into(FinanceMerchantRule)
    .values({ ...rule, hits: 1 })
    .onConflict(
      `("householdId", "pattern", "kind") DO UPDATE SET "categoryId" = EXCLUDED."categoryId",
        "hits" = "finance_merchant_rules"."hits" + 1, "updatedAt" = now()`,
    )
    .execute();
}
