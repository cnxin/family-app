import { useHouseholdToday } from '../lib/use-household-today';
import { useRef, useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceScreenshotRecognition } from '@family/contracts';
import { postForm } from '../lib/api';
import {
  accountBalanceText,
  isMoneyInput,
  monthLabel,
  useAgentStatus,
  useCreateFinanceTransaction,
} from '../lib/queries';
import { readRecentCategories, rememberCategory } from '../lib/finance-recent';
import { pushToast } from '../lib/toast';
import { CategoryGrid } from './finance-category-grid';
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
  initialMode = 'expense',
}: {
  month: string;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  initialMode?: Mode;
}) {
  const today = useHouseholdToday();
  const create = useCreateFinanceTransaction();
  const usable = accounts.filter((one) => one.isActive);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [amount, setAmount] = useState('');
  // 从信用卡「去还款」进来是转账：默认从一张不是信用卡的账户转进第一张信用卡
  const repayTo = initialMode === 'transfer' ? usable.find((one) => one.type === 'credit') : undefined;
  const [accountId, setAccountId] = useState(
    repayTo ? (usable.find((one) => one.type !== 'credit')?.id ?? '') : (usable[0]?.id ?? ''),
  );
  const [toAccountId, setToAccountId] = useState(repayTo?.id ?? usable[1]?.id ?? '');
  const [categoryId, setCategoryId] = useState(
    categories.find((one) => one.kind === initialMode && one.isActive)?.id ?? '',
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

  const [recent] = useState(readRecentCategories);

  // K2 截图记账：第 2 档对当前成员开着、配的模型能看图才有「传截图」（试用期只有管理员看得到）
  const agentStatus = useAgentStatus();
  const canScan = agentStatus.data?.visionAvailable === true;
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [screenshot, setScreenshot] = useState<{ path: string; merchant: string | null } | null>(null);

  async function scan(file: File) {
    setScanning(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const result = await postForm<FinanceScreenshotRecognition>('/finance/screenshot-recognize', form);
      // 认出来的先填进表单，人看一眼、改一改再点确认才落账
      setMode(result.direction);
      setAmount(String(result.amount));
      if (result.accountId && usable.some((one) => one.id === result.accountId)) setAccountId(result.accountId);
      setCategoryId(
        result.categoryId ?? categories.find((one) => one.isActive && one.kind === result.direction)?.id ?? '',
      );
      setTitle(result.title);
      if (result.occurredOn) setOccurredOn(result.occurredOn);
      setNote(result.note ?? '');
      setScreenshot({ path: result.attachmentPath, merchant: result.merchant });
      navigator.vibrate?.(10);
      pushToast('认出来了，核对一下再确认', undefined, 'success');
    } catch (error) {
      // 没认出来、额度用完、模型出错：说原因，表单照常手填
      pushToast(error instanceof Error ? error.message : '没认出来，手动填吧');
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

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
        ...(screenshot ? { attachmentPath: screenshot.path, merchant: screenshot.merchant } : {}),
      },
      {
        onSuccess: () => {
          if (mode !== 'transfer') rememberCategory(categoryId);
          pushToast(`记下了「${title.trim()}」`, undefined, 'success');
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
        {canScan ? (
          <div className="flex flex-col gap-1.5 rounded-card border border-border bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-9 shrink-0 px-3 text-[13px]"
                disabled={scanning}
                aria-busy={scanning}
                onClick={() => fileRef.current?.click()}
              >
                {scanning ? '识别中…' : screenshot ? '换一张截图' : '传截图'}
              </Button>
              <p className="min-w-0 flex-1 text-[12px] text-ink-soft">
                {screenshot ? '已附上截图，确认记账时一起存下。' : '支付宝、微信的付款截图，认出来先填好，你确认了才记。'}
              </p>
              {screenshot && !scanning ? (
                <button
                  type="button"
                  className="shrink-0 text-[12px] text-ink-soft underline-offset-2 hover:underline"
                  onClick={() => setScreenshot(null)}
                >
                  不附了
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-ink-soft">截图会发给家里配置的模型服务商识别，算一次小管家的云端额度。</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="选择截图"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void scan(file);
              }}
            />
          </div>
        ) : null}
        <p className="text-[12px] text-ink-soft">记错了在流水里点那一笔就能改、能删。</p>

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
                {one.name} {accountBalanceText(one)}
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
            <CategoryGrid
              categories={categories}
              kind={mode}
              value={categoryId}
              recent={recent}
              label={mode === 'expense' ? '支出分类' : '收入分类'}
              onChange={(category) => setCategoryId(category.id)}
            />
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
