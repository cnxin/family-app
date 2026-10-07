import { useEffect, useMemo, useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTransactionType, UpdatedFinanceTransaction } from '@family/contracts';
import { recentCategoryIds } from '../lib/finance-recent';
import { canEditTransaction, LEDGER_LIMIT, useBatchFinanceTransactions, useFinanceTransactions } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { BatchBar, BatchDialog, type BatchAction } from './finance-ledger-batch';
import { FilterChips, FilterDialog, type LedgerFilters } from './finance-ledger-filters';
import { LedgerRow } from './finance-ledger-row';
import { TransactionEditor } from './finance-transaction-edit';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, EmptyState, Input, Panel, Segmented } from './ui';

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * 「流水」分段（K5）：搜索（300 ms 防抖）+ 筛选抽屉（分类 / 账户 / 成员 / 显示已删除，摆成可删的小标签），和月份叠加；
 * 点一笔改（成员只能改自己记的）；「选择」进批量模式改分类 / 改账户 / 删除。
 */
export function LedgerPanel({
  month,
  canManage,
  memberId,
  accounts,
  categories,
  members,
}: {
  month: string;
  canManage: boolean;
  memberId: string | undefined;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  members: { id: string; name: string }[];
}) {
  const [type, setType] = useState<FinanceTransactionType | 'all'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [filters, setFilters] = useState<LedgerFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const list = useFinanceTransactions(month, { type, q, ...filters });
  const followUp = useBatchFinanceTransactions();
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const recent = useMemo(() => recentCategoryIds(rows), [rows]);
  const editable = (entry: FinanceTransaction) => canEditTransaction(entry, memberId, canManage);
  const filterCount = Object.values(filters).filter(Boolean).length;
  const chosen = rows.filter((entry) => selected.has(entry.id));
  const majorityKind = chosen.filter((entry) => entry.type === 'income').length > chosen.length / 2 ? 'income' : 'expense';

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  /** 改了分类、同商户还有别的笔分类不一样：toast 带按钮「同时改另外 N 笔」（面板一直在，编辑框关了按钮也能用） */
  function offerSameMerchant(saved: UpdatedFinanceTransaction) {
    if (!saved.sameMerchantPending || !saved.category) return;
    const { sameMerchantIds: ids, sameMerchantPending: count } = saved;
    const category = saved.category;
    pushToast(`「${saved.merchant ?? saved.title}」还有 ${count} 笔不是「${category.name}」`, undefined, 'info', {
      label: `同时改另外 ${count} 笔`,
      run: () =>
        followUp.mutate(
          { ids, action: 'category', categoryId: category.id },
          {
            onSuccess: (result) => pushToast(`已改 ${result.done} 笔，跳过 ${result.skipped.length} 笔`, undefined, 'success'),
            onError: (error) => pushToast(error instanceof Error ? error.message : '没改成', undefined, 'error'),
          },
        ),
    });
  }

  return (
    <Panel
      title="流水"
      right={
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'all' as const, label: '全部' },
            { value: 'expense' as const, label: '支出' },
            { value: 'income' as const, label: '收入' },
            { value: 'transfer' as const, label: '转账' },
          ]}
        />
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          type="search"
          value={search}
          aria-label="搜流水"
          placeholder="名称、商户、备注，或金额如 439 / 100-200"
          className="h-9 min-w-0 flex-1"
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="outline" className="h-9 shrink-0 px-3 text-[13px]" onClick={() => setFilterOpen(true)}>
          筛选{filterCount ? ` · ${filterCount}` : ''}
        </Button>
        {selecting ? null : (
          <Button variant="outline" className="h-9 shrink-0 px-3 text-[13px]" onClick={() => setSelecting(true)}>
            选择
          </Button>
        )}
      </div>
      <FilterChips filters={filters} categories={categories} accounts={accounts} members={members} onChange={setFilters} />
      {selecting ? <BatchBar count={selected.size} onAction={setBatchAction} onCancel={stopSelecting} /> : null}

      <QueryFrame query={list} skeleton={<div className="p-3"><ListSkeleton rows={4} /></div>}>
        {rows.length === 0 ? (
          q || filterCount ? (
            <EmptyState emoji="🔍" title="没有对得上的流水" hint="换个关键词，或者去掉几个筛选" />
          ) : (
            <EmptyState emoji="🧾" title="这个月还没有流水" hint="右上角「记一笔」开始记" />
          )
        ) : (
          <>
            {rows.map((entry, index) => (
              <LedgerRow
                key={entry.id}
                entry={entry}
                first={index === 0}
                editable={editable(entry)}
                selecting={selecting}
                selected={selected.has(entry.id)}
                onToggle={() => toggle(entry.id)}
                onEdit={() => setEditing(entry)}
              />
            ))}
            {rows.length >= LEDGER_LIMIT ? (
              <p className="border-t border-border px-3.5 py-3 text-center text-[12px] text-ink-soft">
                只列了前 {LEDGER_LIMIT} 笔：用搜索或筛选缩小范围
              </p>
            ) : null}
          </>
        )}
      </QueryFrame>

      {filterOpen ? (
        <FilterDialog
          filters={filters}
          categories={categories}
          accounts={accounts}
          members={members}
          onClose={() => setFilterOpen(false)}
          onApply={setFilters}
        />
      ) : null}
      {editing ? (
        <TransactionEditor
          entry={editing}
          accounts={accounts}
          categories={categories}
          recent={recent}
          onClose={() => setEditing(null)}
          onSaved={offerSameMerchant}
        />
      ) : null}
      {batchAction ? (
        <BatchDialog
          action={batchAction}
          ids={[...selected]}
          kind={majorityKind}
          accounts={accounts}
          categories={categories}
          recent={recent}
          onClose={() => setBatchAction(null)}
          onDone={() => {
            setBatchAction(null);
            stopSelecting();
          }}
        />
      ) : null}
    </Panel>
  );
}
