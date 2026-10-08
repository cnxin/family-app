import { z } from 'zod';
import { defineTool, type AgentToolDeps } from './context';

export const getFinanceSummaryTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_finance_summary',
    description: '这是家庭共享账本的余额、收支、预算、账户 ID 和分类 ID 的唯一数据来源。回答家庭财务事实或生成记账提案前必须先调用本工具；不得依据对话历史猜测金额、账户或分类。',
    kind: 'read',
    schema: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    }),
    execute: ({ user }, input) => {
      const month = typeof input.month === 'string' ? input.month : undefined;
      return deps.facades.get('finance').summary(month, user);
    },
  });

export const proposeFinanceTransactionTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_finance_transaction',
    description: '为家庭共享账本生成单笔收入、支出或账户间转账提案，只有成员在 Family App 内明确确认后才会写入。调用前必须先用 get_finance_summary 取得真实账户和分类 ID；金额、类型、账户、分类或日期不明确时必须先追问，不得猜测。财务提案不能放入 propose_plan。',
    kind: 'propose',
    schema: z.object({
      type: z.enum(['expense', 'income', 'transfer']),
      amount: z.number().positive().max(999_999_999_999.99),
      accountId: z.string().uuid(),
      toAccountId: z.string().uuid().nullable().optional(),
      categoryId: z.string().uuid().nullable().optional(),
      title: z.string().min(1).max(120),
      note: z.string().max(1000).nullable().optional(),
      occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_finance_transaction', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
