// K1 商户名归一化与分类建议（docs/finance-plan.md §2.3）。纯函数，单测见 scripts/finance-import.check.ts。
import { DEFAULT_INCOME_RULES, DEFAULT_MERCHANT_RULES } from './default-merchant-rules';
import { cleanTitle } from './text-cleaning';

/**
 * 商户名归一化：去掉「-」及其后面的门店 / 业务名（「美团-望京店」→「美团」、「滴滴出行-快车」→「滴滴出行」），
 * 去掉括号里的内容和门店编号（「星巴克(国贸店)」「全家便利店#1024」），去空白、转小写。
 * K5：先按导入清洗去掉订单号样式的词（「Z2204…-金帝星隆城」→「金帝星隆城」），清完只剩占位话的归一成空。
 * 家庭学到的规则按归一化后的名字存（finance_merchant_rules.pattern）。
 */
export function normalizeMerchant(raw: string): string {
  let value = cleanTitle(raw) ?? '';
  // 「-」前至少两个字才切（「7-ELEVEN」不切）
  const dash = value.search(/[-－—–]/);
  if (dash > 1) value = value.slice(0, dash);
  value = value
    .replace(/[（(【[［][^）)】\]］]*[）)】\]］]?/g, '')
    .replace(/(?:no\.?|#|＃)\s*\d+\s*(?:号)?\s*(?:分店|门店|店)?$/i, '')
    .replace(/\d+\s*(?:号)?\s*(?:分店|门店|店)$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return value;
}

export interface LearnedRule {
  pattern: string;
  categoryId: string;
  hits: number;
}

export interface CategorySuggestionInput {
  merchant: string;
  title: string;
  /** 建议记成支出还是收入（不计收支的按支出给建议） */
  kind: 'expense' | 'income';
  platformCategory: string | null;
}

/**
 * 给一行建议分类：家庭学到的规则（模式越长越优先，一样长看命中次数）→ 内置关键词表 → 平台分类 → 其他支出 / 其他收入。
 * 家庭规则要和行的收支对得上（categoryKind 判）；内置表与平台分类给的是 systemKey，由调用方换成本家庭的分类 id。
 */
export function suggestCategory(
  input: CategorySuggestionInput,
  learned: readonly LearnedRule[],
  categoryKind: (categoryId: string) => 'expense' | 'income' | null,
  platformCategories: Readonly<Record<string, string>>,
): { categoryId: string } | { systemKey: string } {
  const merchant = normalizeMerchant(input.merchant);
  const title = input.title.toLowerCase();
  const hit = learned
    .filter((rule) => rule.pattern && merchant.includes(rule.pattern) && categoryKind(rule.categoryId) === input.kind)
    .sort((a, b) => b.pattern.length - a.pattern.length || b.hits - a.hits)[0];
  if (hit) return { categoryId: hit.categoryId };
  const table = input.kind === 'income' ? DEFAULT_INCOME_RULES : DEFAULT_MERCHANT_RULES;
  // 关键词看完整的商户名（K5：「淘宝-某某女装旗舰店」要认出「女装」，归一化会把「-」后面切掉）
  const text = `${(cleanTitle(input.merchant) ?? '').toLowerCase()} ${title}`;
  const keyword = table.find((rule) => rule.keywords.some((word) => text.includes(word.toLowerCase())));
  if (keyword) return { systemKey: keyword.systemKey };
  const platform = input.platformCategory ? platformCategories[input.platformCategory] : undefined;
  if (platform && platform.startsWith(input.kind)) return { systemKey: platform };
  return { systemKey: input.kind === 'income' ? 'income_other' : 'expense_other' };
}
