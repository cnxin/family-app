import { useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceCategoryKind, FinanceRecurring } from '@family/contracts';
import { useHouseholdToday } from '../lib/use-household-today';
import {
  CADENCE_LABELS,
  recurringDueText,
  usePayFinanceRecurring,
  useRemoveFinanceRecurring,
  useSaveFinanceRecurring,
  yuan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { RecurringForm } from './finance-recurring-form';
import { Button, Dialog, EmptyState, Panel } from './ui';
import { Switch } from './ui/switch';
const TONE = { danger: 'text-danger', warn: 'text-warm', soft: 'text-ink-soft' } as const;

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function RecurringRow({
  row,
  first,
  canManage,
  onEdit,
  onRemove,
}: {
  row: FinanceRecurring;
  first: boolean;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const today = useHouseholdToday();
  const pay = usePayFinanceRecurring();
  const save = useSaveFinanceRecurring();
  const due = recurringDueText(row.nextDueOn, today);
  const busy = pay.isPending || save.isPending;

  function markPaid() {
    navigator.vibrate?.(10);
    pay.mutate(
      { id: row.id, dueOn: row.nextDueOn },
      {
        onSuccess: (result) =>
          pushToast(`记下了「${row.title}」这一期，下一期 ${recurringDueText(result.recurring.nextDueOn, today).text}`),
        onError: (error) => pushToast(errorText(error, '没记上')),
      },
    );
  }

  function patch(body: { autoPost?: boolean; isActive?: boolean }, done: string) {
    save.mutate(
      { id: row.id, expectedVersion: row.version, body },
      {
        onSuccess: () => pushToast(done),
        onError: (error) => pushToast(errorText(error, '没改成')),
      },
    );
  }

  return (
    <article
      aria-label={row.title}
      className={
        'flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 ' +
        (first ? '' : 'border-t border-border ') +
        (row.isActive ? '' : 'opacity-60')
      }
    >
      <div className="min-w-[180px] flex-1">
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.category.color }} />
          <span className="truncate text-[14px] font-medium">{row.title}</span>
          {row.isActive ? null : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">已停用</span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {CADENCE_LABELS[row.cadence]} {row.type === 'income' ? '+' : ''}
          {yuan(row.amount)} · {row.account.name} · {row.category.name}
        </p>
        {row.isActive ? (
          <p className={'mt-0.5 text-[12px] ' + TONE[due.tone]}>
            下一期 {due.text}
            {row.autoPost ? ' · 到期自动记' : ''}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {row.payable ? (
          <Button className="h-8 px-3 text-[13px]" aria-label={`已付${row.title}`} disabled={busy} onClick={markPaid}>
            {pay.isPending ? '记录中…' : '已付'}
          </Button>
        ) : null}
        {canManage ? (
          <>
            {row.isActive ? (
              <Switch
                label={`自动记账${row.title}`}
                checked={row.autoPost}
                pending={save.isPending}
                onChange={(next) => patch({ autoPost: next }, next ? `「${row.title}」到期会自动记账` : `「${row.title}」改成到期提醒`)}
              />
            ) : null}
            <Button variant="ghost" className="h-8 px-2 text-[13px]" aria-label={`编辑${row.title}`} onClick={onEdit}>
              编辑
            </Button>
            <Button
              variant="ghost"
              className={'h-8 px-2 text-[13px] ' + (row.isActive ? '' : 'text-accent')}
              aria-label={`${row.isActive ? '停用' : '启用'}${row.title}`}
              disabled={busy}
              onClick={() => patch({ isActive: !row.isActive }, row.isActive ? `「${row.title}」停用了` : `「${row.title}」重新启用了`)}
            >
              {row.isActive ? '停用' : '启用'}
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px] text-danger"
              aria-label={`删除${row.title}`}
              onClick={onRemove}
            >
              删除
            </Button>
          </>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
            {row.autoPost ? '自动记账' : '到期提醒'}
          </span>
        )}
      </div>
    </article>
  );
}

/** 「固定支出」分段（K3）：管理员增删改、开关自动记账；成员只读，到期的可以点「已付」。 */
export function RecurringPanel({
  rows,
  accounts,
  categories,
  canManage,
}: {
  rows: FinanceRecurring[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  canManage: boolean;
}) {
  const remove = useRemoveFinanceRecurring();
  const [editing, setEditing] = useState<FinanceRecurring | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<FinanceRecurring | null>(null);
  const active = rows.filter((one) => one.isActive);
  const monthly = (type: FinanceCategoryKind) =>
    active.filter((one) => one.type === type).reduce((sum, one) => sum + one.monthlyAmount, 0);

  return (
    <Panel
      title={`固定支出 ${rows.length}`}
      right={
        canManage ? (
          <Button
            variant="ghost"
            className="h-7 px-2 text-[12px]"
            disabled={!accounts.some((one) => one.isActive)}
            onClick={() => setCreating(true)}
          >
            + 新增
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="还没有周期账单"
          hint={
            canManage
              ? '房租、物业费、会员这类每期都要付的，建一条就不用每次手记'
              : '让家庭管理员把房租、物业费这些建进来'
          }
        />
      ) : (
        <>
          <p className="border-b border-border px-3.5 py-2 text-[12px] text-ink-soft">
            在用的折成每月：支出约 {yuan(monthly('expense'))}
            {monthly('income') > 0 ? `，收入约 ${yuan(monthly('income'))}` : ''}
          </p>
          {rows.map((row, index) => (
            <RecurringRow
              key={row.id}
              row={row}
              first={index === 0}
              canManage={canManage}
              onEdit={() => setEditing(row)}
              onRemove={() => setRemoving(row)}
            />
          ))}
        </>
      )}
      {canManage ? null : (
        <p className="border-t border-border px-3.5 py-2.5 text-center text-[12px] text-ink-soft">
          只有家庭管理员能增删改；到期的可以点「已付」记一笔。
        </p>
      )}

      {creating ? (
        <RecurringForm editing={null} accounts={accounts} categories={categories} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <RecurringForm editing={editing} accounts={accounts} categories={categories} onClose={() => setEditing(null)} />
      ) : null}
      {removing ? (
        <Dialog
          title={`删掉「${removing.title}」？`}
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemoving(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { id: removing.id, expectedVersion: removing.version },
                    {
                      onSuccess: () => {
                        navigator.vibrate?.(10);
                        setRemoving(null);
                        pushToast('周期账单已删除');
                      },
                      onError: (error) => pushToast(errorText(error, '没删掉')),
                    },
                  )
                }
              >
                删除
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">只删这条规则，已经记下的流水不受影响。只是暂时不付的话可以先「停用」。</p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
