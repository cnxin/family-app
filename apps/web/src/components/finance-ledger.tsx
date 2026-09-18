import { useState } from 'react';
import type { FinanceTransaction, FinanceTransactionType } from '@family/contracts';
import { useFinanceTransactions, useReverseFinanceTransaction, yuan } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ListSkeleton } from './skeleton';
import { Button, Dialog, EmptyState, Panel, Segmented } from './ui';

const TYPE_STYLE: Record<FinanceTransactionType, { emoji: string; className: string }> = {
  expense: { emoji: '↗', className: 'text-danger' },
  income: { emoji: '↙', className: 'text-accent' },
  transfer: { emoji: '⇄', className: 'text-ink' },
  reversal: { emoji: '↺', className: 'text-ink-soft' },
};

function amountText(entry: FinanceTransaction) {
  if (entry.type === 'expense') return `-${yuan(entry.amount)}`;
  if (entry.type === 'income') return `+${yuan(entry.amount)}`;
  return yuan(entry.amount);
}

/** 转账两条分录的顺序由数据库决定，按 delta 正负排一下才能稳定显示成「转出 → 转入」。 */
function accountPath(entry: FinanceTransaction) {
  return [...entry.postings]
    .sort((a, b) => a.delta - b.delta)
    .map((posting) => posting.account?.name)
    .filter(Boolean)
    .join(' → ');
}

export function LedgerPanel({ month, canManage }: { month: string; canManage: boolean }) {
  const [filter, setFilter] = useState<FinanceTransactionType | 'all'>('all');
  const list = useFinanceTransactions(month, filter);
  const reverse = useReverseFinanceTransaction();
  const [reversing, setReversing] = useState<FinanceTransaction | null>(null);

  const rows = list.data ?? [];

  return (
    <Panel
      title="流水"
      right={
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: '全部' },
            { value: 'expense' as const, label: '支出' },
            { value: 'income' as const, label: '收入' },
            { value: 'transfer' as const, label: '转账' },
          ]}
        />
      }
    >
      {list.isPending ? (
        <div className="p-3">
          <ListSkeleton rows={4} />
        </div>
      ) : list.isError ? (
        <EmptyState emoji="🧾" title="流水读不出来" hint="刷新一下，还不行就看看 API 服务" />
      ) : rows.length === 0 ? (
        <EmptyState emoji="🧾" title="这个月还没有流水" hint="右上角「记一笔」开始记" />
      ) : (
        rows.map((entry, index) => {
          const style = TYPE_STYLE[entry.type];
          return (
            <article
              key={entry.id}
              aria-label={entry.title}
              className={
                'flex items-center gap-2 px-3.5 py-3 ' +
                (index ? 'border-t border-border ' : '') +
                (entry.reversed ? 'opacity-60' : '')
              }
            >
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-muted ${style.className}`}>
                {style.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{entry.title}</p>
                <p className="truncate text-[12px] text-ink-soft">
                  {[entry.occurredOn, entry.category?.name, accountPath(entry), entry.actorName]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {entry.note ? (
                  <p className="truncate text-[12px] text-ink-soft">{entry.note}</p>
                ) : null}
                {entry.reversed ? (
                  <p className="text-[12px] text-warm">已经被一笔反向流水撤销</p>
                ) : null}
              </div>
              {/* 金额和撤销放同一列，手机上才不会把「撤销」甩到下一行去 */}
              <div className="flex shrink-0 items-center gap-1">
                <span className={`text-[14px] font-semibold tabular-nums ${style.className}`}>
                  {amountText(entry)}
                </span>
                {canManage && entry.type !== 'reversal' && !entry.reversed ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-[13px]"
                    aria-label={`撤销${entry.title}`}
                    onClick={() => setReversing(entry)}
                  >
                    撤销
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })
      )}

      {reversing ? (
        <Dialog
          title="撤销这笔流水？"
          onClose={() => setReversing(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setReversing(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={reverse.isPending}
                onClick={() =>
                  reverse.mutate(
                    {
                      id: reversing.id,
                      idempotencyKey: `finance:transaction:reverse:${reversing.id}:${Date.now()}`,
                    },
                    {
                      onSuccess: () => {
                        setReversing(null);
                        pushToast(`「${reversing.title}」已撤销`);
                      },
                    },
                  )
                }
              >
                {reverse.isPending ? '撤销中…' : '确认撤销'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            原来那笔留着不动，另记一笔金额相反的撤销流水；账户余额和本月统计会跟着回到撤销前。
            撤销流水记在今天，所以如果撤的是往月的账，它会出现在这个月的列表里。
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
