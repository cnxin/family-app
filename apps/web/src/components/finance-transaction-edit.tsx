import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  UpdatedFinanceTransaction,
  UpdateFinanceTransactionBody,
} from '@family/contracts';
import { apiBlob } from '../lib/api';
import { rememberCategory } from '../lib/finance-recent';
import { isMoneyInput, useDeleteFinanceTransaction, useUpdateFinanceTransaction, yuan } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { CategoryGrid } from './finance-category-grid';
import { Button, Dialog, Input, Segmented } from './ui';

type Mode = 'expense' | 'income' | 'transfer';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

/** K2：截图记的流水在编辑面板里给一张缩略图，点开看原图（截图要登录才能取，走 blob URL）。 */
function ScreenshotThumb({ transactionId }: { transactionId: string }) {
  const [open, setOpen] = useState(false);
  const blob = useQuery({
    queryKey: ['finance-attachment', transactionId],
    queryFn: () => apiBlob(`/finance/transactions/${transactionId}/attachment`),
    staleTime: Infinity,
  });
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (blob.isError) return <p className="text-[12px] text-ink-soft">截图取不到了</p>;
  return (
    <>
      <button
        type="button"
        aria-label="看截图原图"
        disabled={!url}
        className="flex items-center gap-2 self-start rounded-lg border border-border p-1 pr-3 text-[12px] text-ink-soft transition-colors duration-150 hover:bg-muted"
        onClick={() => setOpen(true)}
      >
        {url ? (
          <img src={url} alt="记账截图" className="size-12 rounded-md object-cover" />
        ) : (
          <span className="size-12 rounded-md bg-muted motion-safe:animate-pulse" />
        )}
        截图
      </button>
      {open && url ? (
        <Dialog title="记账截图" place="center" maxWidth={520} onClose={() => setOpen(false)}>
          <img src={url} alt="记账截图原图" className="mx-auto max-h-[70vh] w-auto rounded-lg" />
        </Dialog>
      ) : null}
    </>
  );
}

/** 从分录读出这笔现在记在哪：支出 / 收入一条分录；转账负的是转出、正的是转入。 */
export function transactionAccounts(entry: FinanceTransaction) {
  const from = entry.postings.find((posting) => posting.delta < 0);
  const to = entry.postings.find((posting) => posting.delta > 0);
  return {
    accountId: (entry.type === 'income' ? to : from)?.accountId ?? '',
    toAccountId: entry.type === 'transfer' ? (to?.accountId ?? '') : '',
  };
}

/**
 * 改一笔（K5）：名称、分类、备注、日期、商户原地改；金额、账户、收支方向改了会冲销原笔、另记一笔（提示一句）。
 * 底部「删除」二次确认。保存后同商户还有别的笔分类不一样时，交给流水面板弹「同时改另外 N 笔」。
 */
export function TransactionEditor({
  entry,
  accounts,
  categories,
  recent,
  onClose,
  onSaved,
}: {
  entry: FinanceTransaction;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  recent: readonly string[];
  onClose: () => void;
  onSaved: (saved: UpdatedFinanceTransaction) => void;
}) {
  const update = useUpdateFinanceTransaction();
  const remove = useDeleteFinanceTransaction();
  const original = transactionAccounts(entry);
  const [type, setType] = useState<Mode>(entry.type === 'reversal' ? 'expense' : entry.type);
  const [amount, setAmount] = useState(String(entry.amount));
  const [accountId, setAccountId] = useState(original.accountId);
  const [toAccountId, setToAccountId] = useState(original.toAccountId);
  const [categoryId, setCategoryId] = useState<string | null>(entry.categoryId);
  const [title, setTitle] = useState(entry.title);
  const [occurredOn, setOccurredOn] = useState(entry.occurredOn);
  const [merchant, setMerchant] = useState(entry.merchant ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const usable = accounts.filter((one) => one.isActive || one.id === original.accountId || one.id === original.toAccountId);
  const amountChanged = isMoneyInput(amount) && Math.round(Number(amount) * 100) !== Math.round(entry.amount * 100);
  const moneyChanged =
    type !== entry.type || amountChanged || accountId !== original.accountId || (type === 'transfer' && toAccountId !== original.toAccountId);

  function changeType(next: Mode) {
    setType(next);
    if (next === 'transfer') return;
    const current = categories.find((one) => one.id === categoryId);
    if (!current || current.kind !== next) setCategoryId(null);
  }

  function save() {
    if (!isMoneyInput(amount) || Number(amount) <= 0) return setMessage('金额要大于 0，最多两位小数');
    if (!title.trim()) return setMessage('名称不能空着');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setMessage('转入账户要选一个别的账户');
    if (type !== 'transfer' && !categoryId) return setMessage('选一个分类');
    const body: UpdateFinanceTransactionBody = {};
    if (title.trim() !== entry.title) body.title = title.trim();
    if (note.trim() !== (entry.note ?? '')) body.note = note.trim() || null;
    if (merchant.trim() !== (entry.merchant ?? '')) body.merchant = merchant.trim() || null;
    if (occurredOn !== entry.occurredOn) body.occurredOn = occurredOn;
    if (type !== entry.type) body.type = type;
    if (type !== 'transfer' && (categoryId !== entry.categoryId || type !== entry.type)) body.categoryId = categoryId;
    if (amountChanged) body.amount = Number(amount);
    if (accountId !== original.accountId) body.accountId = accountId;
    if (type === 'transfer' && toAccountId !== original.toAccountId) body.toAccountId = toAccountId;
    if (!Object.keys(body).length) return onClose();
    setMessage(null);
    navigator.vibrate?.(10);
    update.mutate(
      { id: entry.id, body },
      {
        onSuccess: (saved) => {
          if (body.categoryId) rememberCategory(body.categoryId);
          pushToast(moneyChanged ? `改好了：「${saved.title}」重记了一笔，原来的留在历史里` : `改好了：「${saved.title}」`, undefined, 'success');
          onSaved(saved);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没改成'),
      },
    );
  }

  function confirmRemove() {
    navigator.vibrate?.(10);
    remove.mutate(entry.id, {
      onSuccess: () => {
        pushToast(`删掉了「${entry.title}」，余额已经回到记这笔之前`, undefined, 'success');
        onClose();
      },
      onError: (error) => {
        setConfirmDelete(false);
        setMessage(error instanceof Error ? error.message : '没删掉');
      },
    });
  }

  const busy = update.isPending || remove.isPending;
  return (
    <Dialog
      title="改一笔"
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          {moneyChanged ? (
            <p className="text-[12px] text-warm">金额 / 账户改动会重记一笔，原记录保留在历史里。</p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              删除
            </Button>
            <Button className="flex-1" disabled={busy} onClick={save}>
              {update.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">
          {[
            entry.sourceType === 'import'
              ? `${entry.actorName}导入`
              : entry.sourceType === 'screenshot'
                ? `${entry.actorName}传截图记的`
                : `${entry.actorName}记的`,
            entry.occurredOn,
          ].join(' · ')}
        </p>
        {entry.attachmentPath ? <ScreenshotThumb transactionId={entry.id} /> : null}
        <Segmented
          label="收支方向"
          value={type}
          onChange={changeType}
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
              inputMode="decimal"
              value={amount}
              maxLength={15}
              aria-label="金额"
              className="h-12 text-xl font-semibold tabular-nums"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          {amountChanged ? <span className="mt-1 block text-[12px] text-ink-soft">原来是 {yuan(entry.amount)}</span> : null}
        </label>
        <div>
          <span className={label}>{type === 'transfer' ? '从哪个账户转出' : '哪个账户'}</span>
          <div className="flex flex-wrap gap-1.5">
            {usable.map((one) => (
              <button key={one.id} type="button" aria-pressed={accountId === one.id} className={chip(accountId === one.id)} onClick={() => setAccountId(one.id)}>
                {one.name}
              </button>
            ))}
          </div>
        </div>
        {type === 'transfer' ? (
          <div>
            <span className={label}>转到哪个账户</span>
            <div className="flex flex-wrap gap-1.5">
              {usable
                .filter((one) => one.id !== accountId)
                .map((one) => (
                  <button key={one.id} type="button" aria-pressed={toAccountId === one.id} className={chip(toAccountId === one.id)} onClick={() => setToAccountId(one.id)}>
                    {one.name}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div>
            <span className={label}>{type === 'expense' ? '支出分类' : '收入分类'}</span>
            <CategoryGrid
              categories={categories}
              kind={type}
              value={categoryId}
              recent={recent}
              label={type === 'expense' ? '支出分类' : '收入分类'}
              onChange={(category) => setCategoryId(category.id)}
            />
          </div>
        )}
        <label className="block">
          <span className={label}>名称</span>
          <Input value={title} maxLength={120} aria-label="名称" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>日期</span>
            <Input type="date" value={occurredOn} aria-label="日期" onChange={(event) => setOccurredOn(event.target.value)} />
          </label>
          <label className="block">
            <span className={label}>商户（选填）</span>
            <Input value={merchant} maxLength={120} aria-label="商户" placeholder="交易对方" onChange={(event) => setMerchant(event.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={label}>备注（选填）</span>
          <Input value={note} maxLength={1000} aria-label="备注" onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>

      {confirmDelete ? (
        <Dialog
          title="删除这笔？"
          place="center"
          onClose={() => setConfirmDelete(false)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
              <Button className="flex-1 bg-danger text-on-danger" disabled={remove.isPending} onClick={confirmRemove}>
                {remove.isPending ? '删除中…' : '确认删除'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            「{entry.title}」{yuan(entry.amount)} 会从流水里拿掉，账户余额回到记这笔之前。账本里会留一笔冲销记录，
            在流水的筛选里打开「显示已删除」还能看到它。
          </p>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
