import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  BatchFinanceTransactionsBody,
  FinanceBatchResult,
  FinanceTransaction,
  UpdatedFinanceTransaction,
  UpdateFinanceTransactionBody,
} from '@family/contracts';
import { api } from '../api';
import { invalidateModules } from './modules';

// K5 流水编辑：改一笔、删一笔、批量。成员只能动自己记的（服务端逐条判），界面上也只给能动的笔出入口。

/** 周期账单自动记的流水显示名（和后端 RECURRING_ACTOR_NAME 一致）：只有管理员能改 */
export const AUTO_POSTED_ACTOR = '自动记账';

/** 这个人能不能改这一笔：撤销笔、已删、已改过、已撤销的都不能改；成员只能改自己记的、不能改自动记账的。 */
export function canEditTransaction(entry: FinanceTransaction, memberId: string | undefined, canManage: boolean) {
  if (entry.type === 'reversal' || entry.deletedAt || entry.supersededById || entry.reversed) return false;
  if (canManage) return true;
  if (entry.sourceType === 'recurring' && entry.actorName === AUTO_POSTED_ACTOR) return false;
  return entry.actorId === memberId;
}

function useLedgerMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateModules(client);
      void client.invalidateQueries({ queryKey: ['finance'] });
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateFinanceTransaction() {
  return useLedgerMutation<{ id: string; body: UpdateFinanceTransactionBody }, UpdatedFinanceTransaction>(({ id, body }) =>
    api<UpdatedFinanceTransaction>(`/finance/transactions/${id}`, { method: 'PATCH', body }),
  );
}

export function useDeleteFinanceTransaction() {
  return useLedgerMutation<string, FinanceTransaction>((id) =>
    api<FinanceTransaction>(`/finance/transactions/${id}`, { method: 'DELETE' }),
  );
}

/** 批量一次最多 200 笔：超过就分几次发，结果加起来。 */
export function useBatchFinanceTransactions() {
  return useLedgerMutation<BatchFinanceTransactionsBody, FinanceBatchResult>(async (body) => {
    const total: FinanceBatchResult = { done: 0, skipped: [] };
    for (let start = 0; start < body.ids.length; start += 200) {
      const part = await api<FinanceBatchResult>('/finance/transactions/batch', {
        method: 'POST',
        body: { ...body, ids: body.ids.slice(start, start + 200) },
      });
      total.done += part.done;
      total.skipped.push(...part.skipped);
    }
    return total;
  });
}
