import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceSummary,
  FinanceTransaction,
  FinanceTransactionType,
} from '@family/contracts';
import { api } from '../api';

export const ACCOUNT_TYPE_LABELS: Record<FinanceAccountType, string> = {
  cash: '现金',
  bank: '银行卡',
  alipay: '支付宝',
  wechat: '微信',
  other: '其他',
};

export const TRANSACTION_TYPE_LABELS: Record<FinanceTransactionType, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  reversal: '撤销',
};

/**
 * 金额一律是「元」的 number（后端 money() 已经规整到两位小数）。
 * 旧客户端这里用了 Math.abs，负的结余和超支后的「剩余」会显示成正数——意思正好反了，
 * 所以这一版负号必须留着。
 */
export function yuan(value: number, signed = false) {
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  const digits = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', digits)}`;
}

/** 两位小数只能用字符串正则判：`8.29 * 100` 是 828.9999999999999，用浮点算会把合法金额判掉。 */
export function isMoneyInput(raw: string) {
  return /^\d+(\.\d{1,2})?$/.test(raw.trim());
}

/** 家里的账按上海时区记，和后端 currentMonth() 一致，不跟着浏览器所在时区飘。 */
function shanghai(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function financeToday() {
  return shanghai();
}

export function monthNow() {
  return shanghai().slice(0, 7);
}

export function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string) {
  const [year, index] = month.split('-');
  return `${year} 年 ${Number(index)} 月`;
}

export function useFinanceSummary(month: string) {
  return useQuery({
    queryKey: ['finance', 'summary', month],
    queryFn: () => api<FinanceSummary>(`/finance/summary?month=${month}`),
  });
}

export function useFinanceAccounts() {
  return useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: () => api<FinanceAccount[]>('/finance/accounts?includeInactive=true'),
  });
}

export function useFinanceCategories() {
  return useQuery({
    queryKey: ['finance', 'categories'],
    queryFn: () => api<FinanceCategory[]>('/finance/categories?includeInactive=true'),
  });
}

export function useFinanceTransactions(month: string, type: FinanceTransactionType | 'all') {
  return useQuery({
    queryKey: ['finance', 'transactions', month, type],
    queryFn: () =>
      api<FinanceTransaction[]>(
        `/finance/transactions?month=${month}&limit=100${type === 'all' ? '' : `&type=${type}`}`,
      ),
  });
}

function useFinanceMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['finance'] });
      // 每一笔写操作后端都会记一条家庭动态
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useCreateFinanceTransaction() {
  return useFinanceMutation<
    {
      type: 'expense' | 'income' | 'transfer';
      amount: number;
      accountId: string;
      toAccountId: string | null;
      categoryId: string | null;
      title: string;
      note: string | null;
      occurredOn: string;
      idempotencyKey: string;
    },
    FinanceTransaction
  >((body) => api<FinanceTransaction>('/finance/transactions', { method: 'POST', body }));
}

/** 账本不可改：记错了只能补一笔金额相反的撤销流水，原流水留着。 */
export function useReverseFinanceTransaction() {
  return useFinanceMutation<{ id: string; idempotencyKey: string }, FinanceTransaction>(
    ({ id, idempotencyKey }) =>
      api<FinanceTransaction>(`/finance/transactions/${id}/reverse`, {
        method: 'POST',
        body: { idempotencyKey },
      }),
  );
}

export function useUpsertFinanceAccount() {
  return useFinanceMutation<
    {
      id?: string;
      name: string;
      type: FinanceAccountType;
      openingBalance?: number;
      expectedVersion?: number;
    },
    FinanceAccount
  >(({ id, name, type, openingBalance, expectedVersion }) =>
    id
      ? api<FinanceAccount>(`/finance/accounts/${id}`, {
          method: 'PATCH',
          body: { name, type, expectedVersion },
        })
      : api<FinanceAccount>('/finance/accounts', {
          method: 'POST',
          body: { name, type, openingBalance },
        }),
  );
}

/** 启停账户也走 PATCH，必须带上当前 version，不然后端会判成「已被别人改过」。 */
export function useSetFinanceAccountActive() {
  return useFinanceMutation<
    { id: string; isActive: boolean; expectedVersion: number },
    FinanceAccount
  >(({ id, isActive, expectedVersion }) =>
    api<FinanceAccount>(`/finance/accounts/${id}`, {
      method: 'PATCH',
      body: { isActive, expectedVersion },
    }),
  );
}

export function useCreateFinanceCategory() {
  return useFinanceMutation<{ name: string; kind: FinanceCategoryKind }, FinanceCategory>((body) =>
    api<FinanceCategory>('/finance/categories', { method: 'POST', body }),
  );
}

export function useSetFinanceCategoryActive() {
  return useFinanceMutation<
    { id: string; isActive: boolean; expectedVersion: number },
    FinanceCategory
  >(({ id, isActive, expectedVersion }) =>
    api<FinanceCategory>(`/finance/categories/${id}`, {
      method: 'PATCH',
      body: { isActive, expectedVersion },
    }),
  );
}

/** 新建预算时绝对不能带 expectedVersion：后端见到它却查不到预算，会判成「状态已变化」。 */
export function useUpsertFinanceBudget() {
  return useFinanceMutation<
    { categoryId: string; month: string; amount: number; expectedVersion?: number },
    FinanceBudget
  >(({ categoryId, month, amount, expectedVersion }) =>
    api<FinanceBudget>('/finance/budgets', {
      method: 'PUT',
      body: {
        categoryId,
        month,
        amount,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      },
    }),
  );
}

export function useRemoveFinanceBudget() {
  return useFinanceMutation<{ id: string; expectedVersion: number }, { id: string }>(
    ({ id, expectedVersion }) =>
      api<{ id: string }>(`/finance/budgets/${id}?expectedVersion=${expectedVersion}`, {
        method: 'DELETE',
      }),
  );
}
