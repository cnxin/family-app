import { useState } from 'react';
import type { FinanceCategory, FinanceCategoryKind } from '@family/contracts';
import { useCreateFinanceCategory, useSetFinanceCategoryActive } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, Panel, Segmented } from './ui';

function CategoryForm({ onClose }: { onClose: () => void }) {
  const create = useCreateFinanceCategory();
  const [kind, setKind] = useState<FinanceCategoryKind>('expense');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setMessage('先给分类起个名字');
    setMessage(null);
    create.mutate(
      { name: name.trim(), kind },
      {
        onSuccess: () => {
          pushToast(`分类「${name.trim()}」已添加`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title="新增收支分类"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={create.isPending} onClick={submit}>
            {create.isPending ? '保存中…' : '保存分类'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">自己加的分类和系统分类一样，能记账也能设预算。</p>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense' as const, label: '支出分类' },
            { value: 'income' as const, label: '收入分类' },
          ]}
        />
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-soft">名称</span>
          <Input
            autoFocus
            value={name}
            maxLength={80}
            aria-label="分类名称"
            placeholder="比如：宠物"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}

export function CategoriesPanel({
  categories,
  canManage,
}: {
  categories: FinanceCategory[];
  canManage: boolean;
}) {
  const setActive = useSetFinanceCategoryActive();
  const [creating, setCreating] = useState(false);

  return (
    <Panel
      title={`收支分类 ${categories.length}`}
      right={
        canManage ? (
          <Button variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setCreating(true)}>
            + 新增分类
          </Button>
        ) : null
      }
    >
      {categories.map((one, index) => (
        <div
          key={one.id}
          aria-label={one.name}
          className={
            'flex items-center gap-2 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')
          }
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: one.color }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">{one.name}</p>
            <p className="text-[12px] text-ink-soft">
              {one.kind === 'expense' ? '支出' : '收入'}
              {one.systemKey ? ' · 系统默认' : ''}
              {one.isActive ? '' : ' · 已停用'}
            </p>
          </div>
          {canManage ? (
            <Button
              variant="ghost"
              className={'h-8 shrink-0 px-2 text-[13px] ' + (one.isActive ? '' : 'text-accent')}
              aria-label={`${one.isActive ? '停用' : '启用'}分类${one.name}`}
              disabled={setActive.isPending}
              onClick={() =>
                setActive.mutate({
                  id: one.id,
                  isActive: !one.isActive,
                  expectedVersion: one.version,
                })
              }
            >
              {one.isActive ? '停用' : '启用'}
            </Button>
          ) : null}
        </div>
      ))}

      {creating ? <CategoryForm onClose={() => setCreating(false)} /> : null}
    </Panel>
  );
}
