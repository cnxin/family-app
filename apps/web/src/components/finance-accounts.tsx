import { useState } from 'react';
import type { FinanceAccount, FinanceAccountType } from '@family/contracts';
import {
  ACCOUNT_TYPE_LABELS,
  isMoneyInput,
  useSetFinanceAccountActive,
  useUpsertFinanceAccount,
  yuan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, EmptyState, Input, Panel } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
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
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setMessage('先给账户起个名字');
    const raw = openingBalance.trim();
    const negative = raw.startsWith('-');
    if (!editing && !isMoneyInput(negative ? raw.slice(1) : raw)) {
      return setMessage('初始余额最多两位小数');
    }
    setMessage(null);
    save.mutate(
      editing
        ? { id: editing.id, name: name.trim(), type, expectedVersion: editing.version }
        : { name: name.trim(), type, openingBalance: Number(raw) },
      {
        onSuccess: () => {
          pushToast(editing ? '账户已更新' : `已建好账户「${name.trim()}」`);
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
            {(Object.keys(ACCOUNT_TYPE_LABELS) as FinanceAccountType[]).map((value) => (
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
        {editing ? null : (
          <label className="block">
            <span className={label}>初始余额</span>
            <Input
              inputMode="decimal"
              value={openingBalance}
              aria-label="初始余额"
              placeholder="0.00"
              onChange={(event) => setOpeningBalance(event.target.value)}
            />
          </label>
        )}
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
              <p className="mt-0.5 text-[12px] text-ink-soft">{ACCOUNT_TYPE_LABELS[one.type]}</p>
            </div>
            <span className={'text-[15px] font-semibold ' + (one.balance < 0 ? 'text-danger' : '')}>
              {yuan(one.balance)}
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
                          pushToast(one.isActive ? `「${one.name}」已停用` : `「${one.name}」已启用`),
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
