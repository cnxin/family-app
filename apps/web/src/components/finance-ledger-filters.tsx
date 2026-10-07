import { useState } from 'react';
import type { FinanceAccount, FinanceCategory } from '@family/contracts';
import { Button, Dialog, selectClass } from './ui';
import { Switch } from './ui/switch';

/** 流水筛选（K5）：分类、账户、谁记的、显示已删除；搜索框单独在工具条上。 */
export interface LedgerFilters {
  categoryId?: string;
  accountId?: string;
  memberId?: string;
  includeDeleted?: boolean;
}

const label = 'mb-1 block text-[12px] text-ink-soft';

/** 当前筛选摆成一排可删的小标签。 */
export function FilterChips({
  filters,
  categories,
  accounts,
  members,
  onChange,
}: {
  filters: LedgerFilters;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  members: { id: string; name: string }[];
  onChange: (next: LedgerFilters) => void;
}) {
  const chips: { key: keyof LedgerFilters; text: string }[] = [];
  if (filters.categoryId) {
    chips.push({ key: 'categoryId', text: `分类：${categories.find((one) => one.id === filters.categoryId)?.name ?? '已停用'}` });
  }
  if (filters.accountId) {
    chips.push({ key: 'accountId', text: `账户：${accounts.find((one) => one.id === filters.accountId)?.name ?? '已停用'}` });
  }
  if (filters.memberId) {
    chips.push({ key: 'memberId', text: `谁记的：${members.find((one) => one.id === filters.memberId)?.name ?? '家人'}` });
  }
  if (filters.includeDeleted) chips.push({ key: 'includeDeleted', text: '显示已删除' });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-label={`去掉筛选 ${chip.text}`}
          className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] text-accent transition-colors duration-150 hover:brightness-95"
          onClick={() => onChange({ ...filters, [chip.key]: undefined })}
        >
          {chip.text}
          <span aria-hidden>✕</span>
        </button>
      ))}
    </div>
  );
}

/** 筛选抽屉：选好点「完成」才生效。 */
export function FilterDialog({
  filters,
  categories,
  accounts,
  members,
  onClose,
  onApply,
}: {
  filters: LedgerFilters;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  members: { id: string; name: string }[];
  onClose: () => void;
  onApply: (next: LedgerFilters) => void;
}) {
  const [draft, setDraft] = useState<LedgerFilters>(filters);
  const set = (key: keyof LedgerFilters, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value === '' || value === false ? undefined : value }));
  const groups = [
    { kind: 'expense', name: '支出' },
    { kind: 'income', name: '收入' },
  ] as const;
  return (
    <Dialog
      title="筛选流水"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setDraft({})}>
            清空
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            完成
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>分类</span>
          <select
            aria-label="按分类筛"
            className={`${selectClass} h-10 w-full`}
            value={draft.categoryId ?? ''}
            onChange={(event) => set('categoryId', event.target.value)}
          >
            <option value="">全部分类</option>
            {groups.map((group) => (
              <optgroup key={group.kind} label={group.name}>
                {categories
                  .filter((one) => one.kind === group.kind)
                  .map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                      {one.isActive ? '' : '（已停用）'}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>账户</span>
          <select
            aria-label="按账户筛"
            className={`${selectClass} h-10 w-full`}
            value={draft.accountId ?? ''}
            onChange={(event) => set('accountId', event.target.value)}
          >
            <option value="">全部账户</option>
            {accounts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.isActive ? '' : '（已停用）'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>谁记的</span>
          <select
            aria-label="按成员筛"
            className={`${selectClass} h-10 w-full`}
            value={draft.memberId ?? ''}
            onChange={(event) => set('memberId', event.target.value)}
          >
            <option value="">全家</option>
            {members.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px]">显示已删除</p>
            <p className="mt-0.5 text-[12px] text-ink-soft">删掉的、改过金额 / 账户的原来那笔也列出来（灰着，不能再改）。</p>
          </div>
          <Switch label="显示已删除" checked={Boolean(draft.includeDeleted)} onChange={(next) => set('includeDeleted', next)} />
        </div>
      </div>
    </Dialog>
  );
}
