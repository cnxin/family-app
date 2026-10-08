// 财务门面（J4.1）：实现在 apps/api/src/finance/finance.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（get_finance_summary；记账提案的预览与确认后入账）。
import type { CreateFinanceTransactionBody, FinanceSummary } from '../finance';
import type { PluginActor, PluginTransaction } from './kernel';

/** 记一笔之前核对账户与分类的结果。 */
export interface FinanceTransactionPreview {
  account: { id: string; name: string };
  toAccount: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
}

export interface FinanceFacade {
  /** 与 GET /finance/summary?month 同一个实现（月份缺省为本月）。 */
  summary(month: string | undefined, actor: PluginActor): Promise<FinanceSummary>;
  /** 核对账户、转入账户、分类是不是这个家庭的、类型对不对（不写库）。 */
  previewTransaction(input: CreateFinanceTransactionBody, actor: PluginActor): Promise<FinanceTransactionPreview>;
  /** 与记一笔同一个实现（要 record_finance 能力），在调用方的事务里写；来源记成小管家提案。 */
  createTransaction(
    transaction: PluginTransaction,
    input: CreateFinanceTransactionBody,
    actor: PluginActor,
    source: { sourceType: 'agent'; sourceId: string },
  ): Promise<{ id: string }>;
}
