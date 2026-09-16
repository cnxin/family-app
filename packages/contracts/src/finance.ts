import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/finance/finance.module.ts 与 docs/m8-family-finance-plan.md
// 金额：实体列是 numeric 字符串，但所有响应都经 money() 转成 number（两位小数）。
//
// 加载方式说明：
// - GET /finance/accounts、/categories 用 find（eager 全开）→ createdBy 带出；
// - POST /finance/accounts、/categories 直接回传 save() 的结果，save() 不触发 eager → createdBy 缺席；
//   PATCH 先 findOneBy 再 save，返回的是加载过的实体 → createdBy 带出；
// - GET /finance/transactions 用 QueryBuilder 显式 join category/actor/postings.account，
//   eager 不生效 → 嵌套的 category.createdBy / posting.account.createdBy 不带出；
//   POST 回传的 findTransaction 用 find({ relations }) → 一层 eager 会带出。
//   所以嵌套里的 createdBy 一律可选。

export const FINANCE_ACCOUNT_TYPES = ['cash', 'bank', 'alipay', 'wechat', 'other'] as const;
export const financeAccountType = z.enum(FINANCE_ACCOUNT_TYPES);
export type FinanceAccountType = z.infer<typeof financeAccountType>;

export const FINANCE_CATEGORY_KINDS = ['expense', 'income'] as const;
export const financeCategoryKind = z.enum(FINANCE_CATEGORY_KINDS);
export type FinanceCategoryKind = z.infer<typeof financeCategoryKind>;

export const FINANCE_TRANSACTION_TYPES = ['expense', 'income', 'transfer', 'reversal'] as const;
export const financeTransactionType = z.enum(FINANCE_TRANSACTION_TYPES);
export type FinanceTransactionType = z.infer<typeof financeTransactionType>;

export const FINANCE_TRANSACTION_SOURCE_TYPES = [
  'manual',
  'agent',
  'shopping_item',
  'asset',
  'media_subscription',
  'finance_transaction',
] as const;
export const financeTransactionSourceType = z.enum(FINANCE_TRANSACTION_SOURCE_TYPES);

export const currency = z.literal('CNY');
/** YYYY-MM */
export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** 账户实体（嵌套在流水 posting 里时无 balance，createdBy 可能缺席）。 */
export const financeAccountRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    type: financeAccountType,
    openingBalance: z.union([z.number(), z.string()]),
    currency,
    isActive: z.boolean(),
    version: z.number().int(),
    createdById: uuid,
    createdBy: memberSchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

/** 账户列表/写操作回传：presentAccount() 附带实时余额。 */
export const financeAccountSchema = financeAccountRecordSchema.extend({
  openingBalance: z.number(),
  balance: z.number(),
  createdBy: memberSchema,
});
export type FinanceAccount = z.infer<typeof financeAccountSchema>;

/** POST /finance/accounts 回传 save() 结果：save() 不触发 eager，createdBy 缺席。 */
export const createdFinanceAccountSchema = financeAccountRecordSchema.extend({
  openingBalance: z.number(),
  balance: z.number(),
});

export const financeCategoryRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    kind: financeCategoryKind,
    systemKey: z.string().nullable(),
    icon: z.string(),
    color: z.string(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    version: z.number().int(),
    createdById: uuid,
    createdBy: memberSchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });

export const financeCategorySchema = financeCategoryRecordSchema.extend({
  createdBy: memberSchema,
});
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
/** POST /finance/categories 同样直接回传 save() 结果，createdBy 缺席；PATCH 走 findOneBy 则带出。 */
export const createdFinanceCategorySchema = financeCategoryRecordSchema;

export const financePostingSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    transactionId: uuid,
    accountId: uuid,
    account: financeAccountRecordSchema,
    delta: z.number(),
    createdAt: isoDateTime,
  });
export type FinancePosting = z.infer<typeof financePostingSchema>;

export const financeTransactionSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    type: financeTransactionType,
    amount: z.number(),
    currency,
    title: z.string(),
    note: z.string().nullable(),
    occurredOn: dateOnly,
    categoryId: uuid.nullable(),
    category: financeCategoryRecordSchema.nullable(),
    actorId: uuid,
    actor: memberSchema,
    actorName: z.string(),
    sourceType: financeTransactionSourceType,
    sourceId: z.string(),
    reversalOfId: uuid.nullable(),
    postings: z.array(financePostingSchema),
    reversed: z.boolean(),
    reversalId: uuid.nullable(),
    createdAt: isoDateTime,
  });
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;

/** 预算实体 + 月度执行情况（summary / GET budgets）。 */
export const financeBudgetSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    categoryId: uuid,
    category: financeCategoryRecordSchema,
    month: monthString,
    amount: z.number(),
    spent: z.number(),
    remaining: z.number(),
    ratio: z.number(),
    version: z.number().int(),
    updatedById: uuid,
    updatedBy: memberSchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type FinanceBudget = z.infer<typeof financeBudgetSchema>;

/** PUT /finance/budgets 直接回传 save 结果 + category，没有执行情况；首次创建时 updatedBy 缺席。 */
export const financeBudgetRecordSchema = financeBudgetSchema
  .omit({ spent: true, remaining: true, ratio: true })
  .extend({ category: financeCategoryRecordSchema });

export const financeSummarySchema = z
  .object({
    month: monthString,
    currency,
    income: z.number(),
    expense: z.number(),
    net: z.number(),
    totalBalance: z.number(),
    accounts: z.array(financeAccountSchema),
    categories: z.array(financeCategorySchema),
    budgets: z.array(financeBudgetSchema),
    categorySpending: z.array(
      z.object({
        category: financeCategoryRecordSchema.nullable(),
        amount: z.number(),
      }),
    ),
  });
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

// ---- 请求 -------------------------------------------------------------------

export const financeMonthQuery = z.object({ month: monthString.optional() });
export const financeTransactionQuery = financeMonthQuery.extend({
  type: financeTransactionType.optional(),
  accountId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const includeInactiveQuery = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

const MAX_AMOUNT = 99_999_999.99;
export const createFinanceAccountBody = z.object({
  name: z.string().min(1).max(80),
  type: financeAccountType,
  openingBalance: z.number().min(-MAX_AMOUNT).max(MAX_AMOUNT).optional(),
});
export const updateFinanceAccountBody = z.object({
  name: z.string().min(1).max(80).optional(),
  type: financeAccountType.optional(),
  isActive: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});
export const createFinanceCategoryBody = z.object({
  name: z.string().min(1).max(80),
  kind: financeCategoryKind,
  icon: z.string().max(32).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});
export const updateFinanceCategoryBody = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().max(32).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isActive: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});
export const createFinanceTransactionBody = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().min(0.01).max(MAX_AMOUNT),
  accountId: uuid,
  toAccountId: uuid.nullish(),
  categoryId: uuid.nullish(),
  title: z.string().min(1).max(120),
  note: z.string().max(1000).nullish(),
  occurredOn: dateOnly,
  idempotencyKey: z.string().min(1).max(180),
});
export type CreateFinanceTransactionBody = z.infer<typeof createFinanceTransactionBody>;
export const reverseFinanceTransactionBody = z.object({
  note: z.string().max(1000).nullish(),
  idempotencyKey: z.string().min(1).max(180),
});
export const upsertFinanceBudgetBody = z.object({
  categoryId: uuid,
  month: monthString,
  amount: z.number().min(0).max(MAX_AMOUNT),
  expectedVersion: z.number().int().min(1).optional(),
});
export const deleteFinanceBudgetQuery = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});

export const finance = {
  summary: defineEndpoint({
    method: 'GET',
    path: '/finance/summary',
    summary: '月度汇总：收支、余额、预算执行、分类支出',
    query: financeMonthQuery,
    response: financeSummarySchema,
  }),
  accounts: defineEndpoint({
    method: 'GET',
    path: '/finance/accounts',
    summary: '共享账户（含实时余额）',
    query: includeInactiveQuery,
    response: z.array(financeAccountSchema),
  }),
  createAccount: defineEndpoint({
    method: 'POST',
    path: '/finance/accounts',
    summary: '新建账户',
    body: createFinanceAccountBody,
    response: createdFinanceAccountSchema,
  }),
  updateAccount: defineEndpoint({
    method: 'PATCH',
    path: '/finance/accounts/:id',
    summary: '修改账户（乐观锁）',
    params: idParams,
    body: updateFinanceAccountBody,
    response: financeAccountSchema,
  }),
  categories: defineEndpoint({
    method: 'GET',
    path: '/finance/categories',
    summary: '收支分类',
    query: includeInactiveQuery,
    response: z.array(financeCategorySchema),
  }),
  createCategory: defineEndpoint({
    method: 'POST',
    path: '/finance/categories',
    summary: '新建分类',
    body: createFinanceCategoryBody,
    response: createdFinanceCategorySchema,
  }),
  updateCategory: defineEndpoint({
    method: 'PATCH',
    path: '/finance/categories/:id',
    summary: '修改分类（乐观锁）',
    params: idParams,
    body: updateFinanceCategoryBody,
    response: financeCategorySchema,
  }),
  transactions: defineEndpoint({
    method: 'GET',
    path: '/finance/transactions',
    summary: '月度流水（含撤销标记）',
    query: financeTransactionQuery,
    response: z.array(financeTransactionSchema),
  }),
  createTransaction: defineEndpoint({
    method: 'POST',
    path: '/finance/transactions',
    summary: '记一笔收入/支出/转账（不可修改，幂等）',
    body: createFinanceTransactionBody,
    response: financeTransactionSchema,
  }),
  reverseTransaction: defineEndpoint({
    method: 'POST',
    path: '/finance/transactions/:id/reverse',
    summary: '反向流水撤销（幂等）',
    params: idParams,
    body: reverseFinanceTransactionBody,
    response: financeTransactionSchema,
  }),
  budgets: defineEndpoint({
    method: 'GET',
    path: '/finance/budgets',
    summary: '月度分类预算及执行情况',
    query: financeMonthQuery,
    response: z.array(financeBudgetSchema),
  }),
  upsertBudget: defineEndpoint({
    method: 'PUT',
    path: '/finance/budgets',
    summary: '新建或修改某月某分类预算（乐观锁）',
    body: upsertFinanceBudgetBody,
    response: financeBudgetRecordSchema,
  }),
  deleteBudget: defineEndpoint({
    method: 'DELETE',
    path: '/finance/budgets/:id',
    summary: '删除预算（乐观锁）',
    params: idParams,
    query: deleteFinanceBudgetQuery,
    response: z.object({ deleted: z.literal(true), id: uuid }),
  }),
};
