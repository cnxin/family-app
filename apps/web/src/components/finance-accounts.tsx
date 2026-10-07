import { useState } from 'react';
import type { FinanceAccount, FinanceAccountType } from '@family/contracts';
import {
  ACCOUNT_TYPE_LABELS,
  accountBalanceText,
  creditDetail,
  isMoneyInput,
  useSetFinanceAccountActive,
  useUpsertFinanceAccount,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, EmptyState, Input, Panel } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as FinanceAccountType[];

/** 每月几号：1～31 的整数，空串当没填。 */
function dayOfMonth(raw: string) {
  const value = Number(raw.trim());
  return raw.trim() && Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
}
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

export function AccountForm({
  editing,
  onClose,
}: {
  editing: FinanceAccount | null;
  onClose: () => void;
}) {
  const save = useUpsertFinanceAccount();
  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<FinanceAccountType>(editing?.type ?? 'bank');
  const [openingBalance, setOpeningBalance] = useState('0');
  // K4 信用卡：额度选填，账单日 / 还款日必填；新建时填「当前欠多少」（存成负的初始余额）
  const [creditLimit, setCreditLimit] = useState(editing?.creditLimit != null ? String(editing.creditLimit) : '');
  const [billingDay, setBillingDay] = useState(editing?.billingDay ? String(editing.billingDay) : '');
  const [dueDay, setDueDay] = useState(editing?.dueDay ? String(editing.dueDay) : '');
  const [message, setMessage] = useState<string | null>(null);
  const credit = type === 'credit';

  function submit() {
    if (!name.trim()) return setMessage('先给账户起个名字');
    const raw = openingBalance.trim();
    const negative = raw.startsWith('-');
    if (!editing && !isMoneyInput(credit || !negative ? raw : raw.slice(1))) {
      return setMessage(credit ? '当前欠款填 0 或正数，最多两位小数' : '初始余额最多两位小数');
    }
    let creditFields: { creditLimit: number | null; billingDay: number; dueDay: number } | undefined;
    if (credit) {
      const billing = dayOfMonth(billingDay);
      const due = dayOfMonth(dueDay);
      if (!billing || !due) return setMessage('账单日、还款日填每月几号（1～31）');
      if (creditLimit.trim() && (!isMoneyInput(creditLimit) || Number(creditLimit) <= 0)) {
        return setMessage('额度要大于 0，最多两位小数；不知道可以不填');
      }
      creditFields = { creditLimit: creditLimit.trim() ? Number(creditLimit) : null, billingDay: billing, dueDay: due };
    }
    setMessage(null);
    save.mutate(
      editing
        ? { id: editing.id, name: name.trim(), type, expectedVersion: editing.version, credit: creditFields }
        : { name: name.trim(), type, openingBalance: credit ? -Number(raw) : Number(raw), credit: creditFields },
      {
        onSuccess: () => {
          pushToast(editing ? '账户已更新' : `已建好账户「${name.trim()}」`, undefined, 'success');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新增账户'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存账户'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">账户余额 = 初始余额 + 所有流水，建好之后初始余额就不再改了。</p>
        <label className="block">
          <span className={label}>账户名称</span>
          <Input
            autoFocus
            value={name}
            maxLength={80}
            aria-label="账户名称"
            placeholder="比如：日常银行卡"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div>
          <span className={label}>类型</span>
          <div className="flex flex-wrap gap-1.5">
            {ACCOUNT_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                className={chip(type === value)}
                onClick={() => setType(value)}
              >
                {ACCOUNT_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
        {credit ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}>额度（选填）</span>
              <Input
                inputMode="decimal"
                value={creditLimit}
                aria-label="信用额度"
                placeholder="20000"
                onChange={(event) => setCreditLimit(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={label}>每月几号出账单</span>
              <Input
                inputMode="numeric"
                value={billingDay}
                maxLength={2}
                aria-label="账单日"
                placeholder="5"
                onChange={(event) => setBillingDay(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={label}>每月几号还款</span>
              <Input
                inputMode="numeric"
                value={dueDay}
                maxLength={2}
                aria-label="还款日"
                placeholder="23"
                onChange={(event) => setDueDay(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        {editing ? null : (
          <label className="block">
            <span className={label}>{credit ? '当前欠多少（没有就填 0）' : '初始余额'}</span>
            <Input
              inputMode="decimal"
              value={openingBalance}
              aria-label={credit ? '当前欠款' : '初始余额'}
              placeholder="0.00"
              onChange={(event) => setOpeningBalance(event.target.value)}
            />
          </label>
        )}
        {credit ? (
          <p className="text-[12px] text-ink-soft">刷卡消费照常「记一笔」选这张卡；还款就是从银行卡「转账」到这张卡。</p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function AccountsPanel({
  accounts,
  canManage,
}: {
  accounts: FinanceAccount[];
  canManage: boolean;
}) {
  const setActive = useSetFinanceAccountActive();
  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Panel
      title={`财务账户 ${accounts.length}`}
      right={
        canManage ? (
          <Button variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setCreating(true)}>
            + 新增账户
          </Button>
        ) : null
      }
    >
      {accounts.length === 0 ? (
        <EmptyState
          emoji="💳"
          title="还没有财务账户"
          hint={canManage ? '先建一个现金或银行卡账户，才能开始记账' : '让家庭管理员先建一个账户'}
        />
      ) : (
        accounts.map((one, index) => (
          <div
            key={one.id}
            aria-label={one.name}
            className={
              'flex flex-wrap items-center gap-2 px-3.5 py-3 ' +
              (index ? 'border-t border-border' : '')
            }
          >
            <div className="min-w-[140px] flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-medium">{one.name}</span>
                {one.isActive ? null : (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                    已停用
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {ACCOUNT_TYPE_LABELS[one.type]}
                {creditDetail(one) ? ` · ${creditDetail(one)}` : ''}
              </p>
            </div>
            <span className={'text-[15px] font-semibold ' + (one.balance < 0 ? 'text-danger' : '')}>
              {accountBalanceText(one)}
            </span>
            {canManage ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[13px]"
                  aria-label={`编辑${one.name}`}
                  onClick={() => setEditing(one)}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  className={'h-8 px-2 text-[13px] ' + (one.isActive ? '' : 'text-accent')}
                  aria-label={`${one.isActive ? '停用' : '启用'}${one.name}`}
                  disabled={setActive.isPending}
                  onClick={() =>
                    setActive.mutate(
                      { id: one.id, isActive: !one.isActive, expectedVersion: one.version },
                      {
                        onSuccess: () =>
                          pushToast(one.isActive ? `「${one.name}」已停用` : `「${one.name}」已启用`, undefined, 'success'),
                      },
                    )
                  }
                >
                  {one.isActive ? '停用' : '启用'}
                </Button>
              </div>
            ) : null}
          </div>
        ))
      )}

      {creating ? <AccountForm editing={null} onClose={() => setCreating(false)} /> : null}
      {editing ? <AccountForm editing={editing} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}
