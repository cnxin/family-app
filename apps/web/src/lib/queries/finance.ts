import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceRecurring,
  FinanceRecurringCadence,
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
  credit: '信用卡',
};

export const CADENCE_LABELS: Record<FinanceRecurringCadence, string> = {
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季度',
  yearly: '每年',
};

/** 下一期离今天多远：今天 / N 天后 / 已过 N 天；再远就只写日期。 */
export function recurringDueText(nextDueOn: string, today: string) {
  const days = Math.round((Date.parse(`${nextDueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const [, month, day] = nextDueOn.split('-').map(Number);
  const date = `${month} 月 ${day} 日`;
  if (days < 0) return { text: `${date} · 已过 ${-days} 天`, tone: 'danger' as const };
  if (days === 0) return { text: `${date} · 今天`, tone: 'warn' as const };
  if (days <= 3) return { text: `${date} · ${days} 天后`, tone: 'warn' as const };
  return { text: date, tone: 'soft' as const };
}

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

/** K4 信用卡余额为负 = 欠款：卡片上写「欠 ¥…」，不写「余额 -¥…」。 */
export function accountBalanceText(account: Pick<FinanceAccount, 'type' | 'balance'>) {
  if (account.type !== 'credit') return yuan(account.balance);
  if (account.balance < 0) return `欠 ${yuan(-account.balance)}`;
  return account.balance === 0 ? '已还清' : `多还 ${yuan(account.balance)}`;
}

/** 信用卡的额度 / 账单日 / 还款日一行；不是信用卡返回 null。 */
export function creditDetail(account: Pick<FinanceAccount, 'type' | 'creditLimit' | 'billingDay' | 'dueDay'>) {
  if (account.type !== 'credit') return null;
  const parts = [
    account.creditLimit != null ? `额度 ${yuan(account.creditLimit)}` : null,
    account.billingDay ? `每月 ${account.billingDay} 日出账` : null,
    account.dueDay ? `${account.dueDay} 日还款` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 两位小数只能用字符串正则判：`8.29 * 100` 是 828.9999999999999，用浮点算会把合法金额判掉。 */
export function isMoneyInput(raw: string) {
  return /^\d+(\.\d{1,2})?$/.test(raw.trim());
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

/** 流水列表的筛选（K5）：类型、关键词、分类、账户、谁记的、连已删除 / 已改过的一起看；和月份叠加。 */
export interface LedgerFilter {
  type: FinanceTransactionType | 'all';
  q?: string;
  categoryId?: string;
  accountId?: string;
  memberId?: string;
  includeDeleted?: boolean;
}

/** 一页最多 200 笔（接口上限）：导入一个月的账单就可能上百笔。 */
export const LEDGER_LIMIT = 200;

export function useFinanceTransactions(month: string, filter: LedgerFilter) {
  return useQuery({
    queryKey: ['finance', 'transactions', month, filter],
    queryFn: () => {
      const params = new URLSearchParams({ month, limit: String(LEDGER_LIMIT) });
      if (filter.type !== 'all') params.set('type', filter.type);
      if (filter.q?.trim()) params.set('q', filter.q.trim());
      if (filter.categoryId) params.set('categoryId', filter.categoryId);
      if (filter.accountId) params.set('accountId', filter.accountId);
      if (filter.memberId) params.set('memberId', filter.memberId);
      if (filter.includeDeleted) params.set('includeDeleted', 'true');
      return api<FinanceTransaction[]>(`/finance/transactions?${params}`);
    },
    placeholderData: (previous) => previous,
  });
}

export function useFinanceRecurring() {
  return useQuery({
    queryKey: ['finance', 'recurring'],
    queryFn: () => api<FinanceRecurring[]>('/finance/recurring'),
  });
}

function useFinanceMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateModules(client);
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
      /** K4 只有信用卡带：额度（选填）、每月几号出账 / 还款 */
      credit?: { creditLimit: number | null; billingDay: number; dueDay: number };
    },
    FinanceAccount
  >(({ id, name, type, openingBalance, expectedVersion, credit }) =>
    id
      ? api<FinanceAccount>(`/finance/accounts/${id}`, {
          method: 'PATCH',
          body: { name, type, ...(credit ?? {}), expectedVersion },
        })
      : api<FinanceAccount>('/finance/accounts', {
          method: 'POST',
          body: { name, type, openingBalance, ...(credit ?? {}) },
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

export type FinanceRecurringInput = {
  title: string;
  type: FinanceCategoryKind;
  amount: number;
  accountId: string;
  categoryId: string;
  cadence: FinanceRecurringCadence;
  anchorOn: string;
  autoPost: boolean;
};

/** 新建不带 expectedVersion；修改必须带（页面上看到的那个版本），被别人改过 / 已付推进过会 409。 */
export function useSaveFinanceRecurring() {
  return useFinanceMutation<
    { id?: string; expectedVersion?: number; body: Partial<FinanceRecurringInput> & { isActive?: boolean } },
    FinanceRecurring
  >(({ id, expectedVersion, body }) =>
    id
      ? api<FinanceRecurring>(`/finance/recurring/${id}`, { method: 'PATCH', body: { ...body, expectedVersion } })
      : api<FinanceRecurring>('/finance/recurring', { method: 'POST', body }),
  );
}

export function useRemoveFinanceRecurring() {
  return useFinanceMutation<{ id: string; expectedVersion: number }, { id: string }>(({ id, expectedVersion }) =>
    api<{ id: string }>(`/finance/recurring/${id}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }),
  );
}

/** 「已付」带上看到的那一期：重复点同一期后端返回同一笔，不会记成两笔。 */
export function usePayFinanceRecurring() {
  return useFinanceMutation<
    { id: string; dueOn: string },
    { recurring: FinanceRecurring; transaction: FinanceTransaction }
  >(({ id, dueOn }) =>
    api<{ recurring: FinanceRecurring; transaction: FinanceTransaction }>(`/finance/recurring/${id}/pay`, {
      method: 'POST',
      body: { dueOn },
    }),
  );
}
