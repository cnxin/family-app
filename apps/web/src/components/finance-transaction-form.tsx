import { useHouseholdToday } from '../lib/use-household-today';
import { useState } from 'react';
import type { FinanceAccount, FinanceCategory } from '@family/contracts';
import {
  isMoneyInput,
  monthLabel,
  useCreateFinanceTransaction,
  yuan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, Segmented } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

type Mode = 'expense' | 'income' | 'transfer';

export function TransactionForm({
  month,
  accounts,
  categories,
  onClose,
}: {
  month: string;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
}) {
  const today = useHouseholdToday();
  const create = useCreateFinanceTransaction();
  const usable = accounts.filter((one) => one.isActive);

  const [mode, setMode] = useState<Mode>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(usable[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(usable[1]?.id ?? '');
  const [categoryId, setCategoryId] = useState(
    categories.find((one) => one.kind === 'expense' && one.isActive)?.id ?? '',
  );
  const [title, setTitle] = useState('');
  // 翻到往月记账时默认落在那个月的 1 号：旧客户端一律默认今天，
  // 结果人在 7 月的页面上记完，账却记到了 9 月，看起来像是没保存成功。
  const [occurredOn, setOccurredOn] = useState(
    month === today.slice(0, 7) ? today : `${month}-01`,
  );
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // 一次挂载一个幂等键：网络超时后再点一次，后端认得出是同一笔，不会记成两笔
  const [idempotencyKey] = useState(
    () => `finance:transaction:create:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );

  const pickable = categories.filter((one) => one.isActive && one.kind === mode);

  function changeMode(next: Mode) {
    setMode(next);
    if (next !== 'transfer') {
      setCategoryId(categories.find((one) => one.isActive && one.kind === next)?.id ?? '');
    }
  }

  function submit() {
    if (!isMoneyInput(amount) || Number(amount) <= 0) {
      return setMessage('金额要大于 0，最多两位小数');
    }
    if (!accountId) return setMessage('先选一个账户');
    if (mode === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      return setMessage('转入账户要选一个别的账户');
    }
    if (mode !== 'transfer' && !categoryId) return setMessage('选一个收支分类');
    if (!title.trim()) return setMessage('给这笔账起个名字');
    setMessage(null);
    create.mutate(
      {
        type: mode,
        amount: Number(amount),
        accountId,
        toAccountId: mode === 'transfer' ? toAccountId : null,
        categoryId: mode === 'transfer' ? null : categoryId,
        title: title.trim(),
        note: note.trim() || null,
        occurredOn,
        idempotencyKey,
      },
      {
        onSuccess: () => {
          pushToast(`记下了「${title.trim()}」`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没记上'),
      },
    );
  }

  return (
    <Dialog
      title="记一笔"
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={create.isPending} onClick={submit}>
            {create.isPending ? '记录中…' : '确认记账'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">
          记进去的流水不能改，记错了可以由家庭管理员撤销。
        </p>

        <Segmented
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'expense' as const, label: '支出' },
            { value: 'income' as const, label: '收入' },
            { value: 'transfer' as const, label: '转账' },
          ]}
        />

        <label className="block">
          <span className={label}>金额</span>
          <div className="flex items-center gap-2">
            <span className="text-xl text-ink-soft">¥</span>
            <Input
              autoFocus
              inputMode="decimal"
              value={amount}
              maxLength={15}
              aria-label="金额"
              placeholder="0.00"
              className="h-12 text-xl font-semibold"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </label>

        <div>
          <span className={label}>{mode === 'transfer' ? '从哪个账户转出' : '哪个账户'}</span>
          <div className="flex flex-wrap gap-1.5">
            {usable.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={accountId === one.id}
                className={chip(accountId === one.id)}
                onClick={() => setAccountId(one.id)}
              >
                {one.name} {yuan(one.balance)}
              </button>
            ))}
          </div>
        </div>

        {mode === 'transfer' ? (
          <div>
            <span className={label}>转到哪个账户</span>
            <div className="flex flex-wrap gap-1.5">
              {usable
                .filter((one) => one.id !== accountId)
                .map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={toAccountId === one.id}
                    className={chip(toAccountId === one.id)}
                    onClick={() => setToAccountId(one.id)}
                  >
                    {one.name}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div>
            <span className={label}>{mode === 'expense' ? '支出分类' : '收入分类'}</span>
            <div className="flex flex-wrap gap-1.5">
              {pickable.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  aria-pressed={categoryId === one.id}
                  className={chip(categoryId === one.id)}
                  onClick={() => setCategoryId(one.id)}
                >
                  {one.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block">
          <span className={label}>这笔账叫什么</span>
          <Input
            value={title}
            maxLength={120}
            aria-label="账目名称"
            placeholder={
              mode === 'expense' ? '比如：周末聚餐' : mode === 'income' ? '比如：工资' : '比如：转去日常账户'
            }
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>日期</span>
            <Input
              type="date"
              value={occurredOn}
              aria-label="记账日期"
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>备注（选填）</span>
            <Input
              value={note}
              maxLength={1000}
              aria-label="备注"
              placeholder="补充说明"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        {occurredOn.slice(0, 7) !== month ? (
          <p className="text-[12px] text-warm">
            这笔会记到 {monthLabel(occurredOn.slice(0, 7))}，你现在看的是 {monthLabel(month)}。
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
