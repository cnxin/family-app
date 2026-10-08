import type { FinanceFacade, FinanceSummary } from '@family/contracts';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { CreateFinanceTransactionDto } from './finance.module';
import type { FinanceService } from './finance.service';

/** 财务门面的实现（J4.1，接口见 contracts/plugins/finance.facade.ts），FinanceModule 启动时注册。 */
export function financeFacade(finance: FinanceService): FinanceFacade {
  return {
    // 与 GET /finance/summary 返回同一个对象（实体里的 Date 序列化后就是契约里的 ISO 字符串）
    summary: (month, actor) => finance.summary(month, actor) as unknown as Promise<FinanceSummary>,
    previewTransaction: (input, actor) =>
      finance.previewTransaction(input as CreateFinanceTransactionDto, actor),
    async createTransaction(transaction, input, actor, source) {
      const saved = await finance.createWithinTransaction(
        input as CreateFinanceTransactionDto,
        actor,
        fromPluginTransaction(transaction),
        source,
      );
      return { id: saved.id };
    },
  };
}
