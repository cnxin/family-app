import { useState } from 'react';
import type { FinanceBudget, FinanceCategory } from '@family/contracts';
import {
  isMoneyInput,
  monthLabel,
  useRemoveFinanceBudget,
  useUpsertFinanceBudget,
  yuan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, Panel } from './ui';

/** 进度条：超支只是把条填满并变红，具体超了多少看右边的数字。 */
export function BudgetBar({ ratio }: { ratio: number }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={'h-full rounded-full ' + (ratio > 100 ? 'bg-danger' : 'bg-accent')}
        style={{ width: `${Math.min(ratio, 100)}%` }}
      />
    </div>
  );
}

function BudgetForm({
  month,
  category,
  budget,
  onClose,
}: {
  month: string;
  category: { id: string; name: string };
  budget: FinanceBudget | null;
  onClose: () => void;
}) {
  const save = useUpsertFinanceBudget();
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    if (!isMoneyInput(amount)) return setMessage('填个不小于 0 的数字，最多两位小数');
    setMessage(null);
    save.mutate(
      {
        categoryId: category.id,
        month,
        amount: Number(amount),
        // 新建预算时绝不能带版本号：后端见到它却查不到预算，会判成「状态已变化」
        expectedVersion: budget?.version,
      },
      {
        onSuccess: () => {
          pushToast(`${category.name}的预算记好了`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={`${category.name}的月度预算`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存预算'}
          </Button>
        </div>
      }
    >
      <label className="block">
        <span className="mb-1 block text-[12px] text-ink-soft">{monthLabel(month)}能花多少</span>
        <Input
          autoFocus
          inputMode="decimal"
          value={amount}
          aria-label="预算金额"
          placeholder="0.00"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
    </Dialog>
  );
}

export function BudgetsPanel({
  month,
  categories,
  budgets,
  canManage,
}: {
  month: string;
  categories: FinanceCategory[];
  budgets: FinanceBudget[];
  canManage: boolean;
}) {
  const remove = useRemoveFinanceBudget();
  const [editing, setEditing] = useState<{
    category: { id: string; name: string };
    budget: FinanceBudget | null;
  } | null>(null);
  const [removing, setRemoving] = useState<FinanceBudget | null>(null);

  const byCategory = new Map(budgets.map((one) => [one.categoryId, one]));
  const rows = categories
    .filter((one) => one.kind === 'expense' && one.isActive)
    .map((category) => ({ category, budget: byCategory.get(category.id) ?? null }));
  // 分类停用了、预算还在的，也得列出来——否则那笔预算在概览里还算着，却没地方删
  const orphans = budgets
    .filter((one) => !rows.some((row) => row.category.id === one.categoryId))
    .map((one) => ({ category: one.category, budget: one }));

  return (
    <Panel title={`${monthLabel(month)}的分类预算`}>
      {[...rows, ...orphans].map((row, index) => {
        const budget = row.budget;
        return (
          <div
            key={row.category.id}
            aria-label={row.category.name}
            className={'px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.category.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {row.category.name}
                {row.category.isActive ? '' : '（分类已停用）'}
              </span>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums">
                {budget ? yuan(budget.amount) : '未设'}
              </span>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-[13px]"
                    aria-label={`设置${row.category.name}预算`}
                    onClick={() =>
                      setEditing({ category: row.category, budget })
                    }
                  >
                    {budget ? '改' : '设置'}
                  </Button>
                  {budget ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-[13px] text-danger"
                      aria-label={`删除${row.category.name}预算`}
                      onClick={() => setRemoving(budget)}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {budget ? (
              <>
                <p
                  className={
                    'mt-0.5 text-[12px] ' + (budget.ratio > 100 ? 'text-danger' : 'text-ink-soft')
                  }
                >
                  已用 {yuan(budget.spent)} · 剩 {yuan(budget.remaining)} · {budget.ratio}%
                </p>
                <BudgetBar ratio={budget.ratio} />
              </>
            ) : null}
          </div>
        );
      })}

      {canManage ? null : (
        <p className="border-t border-border px-3.5 py-2.5 text-center text-[12px] text-ink-soft">
          只有家庭管理员能改预算。
        </p>
      )}

      {editing ? (
        <BudgetForm
          month={month}
          category={editing.category}
          budget={editing.budget}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {removing ? (
        <Dialog
          title={`删掉${removing.category.name}的预算？`}
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
                        setRemoving(null);
                        pushToast('预算已删除');
                      },
                    },
                  )
                }
              >
                删除预算
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">只删这个月的预算，已经记下的流水不受影响。</p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
