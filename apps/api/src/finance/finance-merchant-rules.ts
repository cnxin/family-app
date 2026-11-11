import { EntityManager } from 'typeorm';

/**
 * 记一条「商户 → 分类」（导入预览里改分类、K5 在流水里改分类都走这里）：pattern 是 normalizeMerchant 之后的商户名；
 * 同一家庭、同一商户、同一收支已有规则就换成这次的分类、hits +1。
 */
export async function learnMerchantRule(
  manager: EntityManager,
  rule: { householdId: string; pattern: string; kind: 'expense' | 'income'; categoryId: string },
) {
  // TypeORM 1.0 删掉了 QueryBuilder 的 onConflict()，数组形式的 orUpdate() 又表达不了「hits 在原值上 +1」，所以直接写 SQL。
  // id、createdAt、updatedAt 走表上的默认值（uuid_generate_v4() / now()）。
  await manager.query(
    `INSERT INTO "finance_merchant_rules" ("householdId", "pattern", "kind", "categoryId", "hits")
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT ("householdId", "pattern", "kind") DO UPDATE SET "categoryId" = EXCLUDED."categoryId",
       "hits" = "finance_merchant_rules"."hits" + 1, "updatedAt" = now()`,
    [rule.householdId, rule.pattern, rule.kind, rule.categoryId],
  );
}
