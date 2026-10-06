import { useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceCategoryKind, FinanceRecurring, FinanceRecurringCadence } from '@family/contracts';
import { useHouseholdToday } from '../lib/use-household-today';
import { CADENCE_LABELS, isMoneyInput, useSaveFinanceRecurring } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, Segmented } from './ui';
import { Switch } from './ui/switch';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

/** 新增 / 编辑一条周期账单（只有管理员能打开）。 */
export function RecurringForm({
  editing,
  accounts,
  categories,
  onClose,
  onRemove,
}: {
  editing: FinanceRecurring | null;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  /** 编辑时给：删除这条（由面板二次确认） */
  onRemove?: () => void;
}) {
  const today = useHouseholdToday();
  const save = useSaveFinanceRecurring();
  const usable = accounts.filter((one) => one.isActive || one.id === editing?.accountId);
  const [type, setType] = useState<FinanceCategoryKind>(editing?.type ?? 'expense');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [accountId, setAccountId] = useState(editing?.accountId ?? usable[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(
    editing?.categoryId ?? categories.find((one) => one.isActive && one.kind === 'expense')?.id ?? '',
  );
  const [cadence, setCadence] = useState<FinanceRecurringCadence>(editing?.cadence ?? 'monthly');
  const [anchorOn, setAnchorOn] = useState(editing?.anchorOn ?? today);
  const [autoPost, setAutoPost] = useState(editing?.autoPost ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const pickable = categories.filter((one) => one.kind === type && (one.isActive || one.id === editing?.categoryId));
  const rescheduled = editing !== null && (cadence !== editing.cadence || anchorOn !== editing.anchorOn);

  function changeType(next: FinanceCategoryKind) {
    setType(next);
    setCategoryId(categories.find((one) => one.isActive && one.kind === next)?.id ?? '');
  }

  function submit() {
    if (!title.trim()) return setMessage('给这笔起个名字，比如：房租');
    if (!isMoneyInput(amount) || Number(amount) <= 0) return setMessage('金额要大于 0，最多两位小数');
    if (!accountId) return setMessage('先选一个账户');
    if (!categoryId) return setMessage('选一个分类');
    if (!anchorOn) return setMessage('选第一次要付的日子');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        expectedVersion: editing?.version,
        body: { title: title.trim(), type, amount: Number(amount), accountId, categoryId, cadence, anchorOn, autoPost },
      },
      {
        onSuccess: (saved) => {
          pushToast(editing ? `「${saved.title}」改好了` : `已建好「${saved.title}」，下一期 ${saved.nextDueOn}`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '新增周期账单'}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存'}
          </Button>
          {editing && onRemove ? (
            <Button
              variant="ghost"
              className="w-full text-danger"
              aria-label={`删除${editing.title}`}
              onClick={onRemove}
            >
              删除这条周期账单
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          value={type}
          onChange={changeType}
          options={[
            { value: 'expense' as const, label: '支出' },
            { value: 'income' as const, label: '收入' },
          ]}
        />
        <label className="block">
          <span className={label}>名称</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="周期账单名称"
            placeholder={type === 'expense' ? '比如：房租、物业费、视频会员' : '比如：工资'}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>每期金额</span>
          <Input
            inputMode="decimal"
            value={amount}
            maxLength={15}
            aria-label="每期金额"
            placeholder="0.00"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <div>
          <span className={label}>{type === 'expense' ? '从哪个账户付' : '进哪个账户'}</span>
          <div className="flex flex-wrap gap-1.5">
            {usable.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={accountId === one.id}
                className={chip(accountId === one.id)}
                onClick={() => setAccountId(one.id)}
              >
                {one.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>{type === 'expense' ? '支出分类' : '收入分类'}</span>
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
        <div>
          <span className={label}>多久一次</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CADENCE_LABELS) as FinanceRecurringCadence[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={cadence === value}
                className={chip(cadence === value)}
                onClick={() => setCadence(value)}
              >
                {CADENCE_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>第一次要付的日子</span>
          <Input
            type="date"
            value={anchorOn}
            aria-label="第一次要付的日子"
            onChange={(event) => setAnchorOn(event.target.value)}
          />
          <span className="mt-1 block text-[12px] text-ink-soft">
            按月 / 季 / 年付取这天的「日」，31 号这种在短月按月末算；早于今天的不往回补。
          </span>
        </label>
        {rescheduled ? (
          <p className="text-[12px] text-warm">改了周期或日子，会从今天起重新算下一期。</p>
        ) : null}
        <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px]">到期自动记账</p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {autoPost ? '到期那天早上 6 点自动记一笔，不用谁去点。' : '到期前 3 天在「留意」里提醒，有人点「已付」才记。'}
            </p>
          </div>
          <Switch label="到期自动记账" checked={autoPost} onChange={setAutoPost} />
        </div>
      </div>
    </Dialog>
  );
}
