import { useState } from 'react';
import type { TravelChecklistCategory, TravelPackingTemplate } from '@family/contracts';
import {
  TRAVEL_CATEGORY_EMOJI,
  TRAVEL_CATEGORY_LABELS,
  travelKey,
  useSaveTravelTemplate,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';

interface Draft {
  key: string;
  title: string;
  category: TravelChecklistCategory;
  quantity: number;
}

function emptyRow(): Draft {
  return { key: travelKey('row'), title: '', category: 'supplies', quantity: 1 };
}

/** 模板改了是整体替换 items（后端语义），已经复制到行程里的清单项不受影响。 */
export function TemplateForm({
  editing,
  onClose,
}: {
  editing: TravelPackingTemplate | null;
  onClose: () => void;
}) {
  const save = useSaveTravelTemplate();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [rows, setRows] = useState<Draft[]>(
    editing?.items.length
      ? editing.items.map((item) => ({
          key: item.id,
          title: item.title,
          category: item.category,
          quantity: item.quantity,
        }))
      : [emptyRow()],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey] = useState(() =>
    travelKey(editing ? `travel:template:update:${editing.id}` : 'travel:template:create'),
  );

  function patch(key: string, next: Partial<Draft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));
  }

  function submit() {
    if (!title.trim()) return setMessage('先给模板起个名字');
    const items = rows
      .map((row) => ({
        title: row.title.trim(),
        category: row.category,
        quantity: row.quantity,
      }))
      .filter((row) => row.title);
    if (items.length !== rows.length) return setMessage('有一行还没填名字');
    if (!items.length) return setMessage('至少写一项');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        expectedVersion: editing?.version,
        idempotencyKey,
        body: { title: title.trim(), description: description.trim() || null, items },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '模板已更新' : `模板「${title.trim()}」建好了`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '新建打包模板'}
      maxWidth={600}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存模板' : '创建模板'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>模板名称</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="模板名称"
            placeholder="周末短途、带娃出门、自驾"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>说明（选填）</span>
          <Input
            value={description}
            maxLength={500}
            aria-label="模板说明"
            placeholder="什么场合用得上"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] text-ink-soft">模板清单</span>
            <Button
              variant="ghost"
              className="h-7 px-2 text-[12px]"
              disabled={rows.length >= 100}
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              + 再加一行
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={row.key} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.title}
                    maxLength={120}
                    aria-label={`模板清单第 ${index + 1} 项`}
                    placeholder={`第 ${index + 1} 项`}
                    className="h-9"
                    onChange={(event) => patch(row.key, { title: event.target.value })}
                  />
                  <Button
                    variant="ghost"
                    className="h-9 shrink-0 px-2 text-[12px] text-danger"
                    aria-label={`删掉第 ${index + 1} 项`}
                    disabled={rows.length <= 1}
                    onClick={() => setRows((current) => current.filter((one) => one.key !== row.key))}
                  >
                    删掉
                  </Button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(Object.keys(TRAVEL_CATEGORY_LABELS) as TravelChecklistCategory[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={row.category === value}
                      className={
                        'rounded-full border px-2 py-0.5 text-[12px] transition-colors duration-150 ' +
                        (row.category === value
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border text-ink-soft hover:bg-muted')
                      }
                      onClick={() => patch(row.key, { category: value })}
                    >
                      {TRAVEL_CATEGORY_EMOJI[value]}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      variant="outline"
                      className="h-7 w-7 px-0 text-[12px]"
                      aria-label={`第 ${index + 1} 项减少数量`}
                      disabled={row.quantity <= 1}
                      onClick={() => patch(row.key, { quantity: row.quantity - 1 })}
                    >
                      −
                    </Button>
                    <span className="min-w-[24px] text-center text-[12px] tabular-nums">
                      {row.quantity}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 w-7 px-0 text-[12px]"
                      aria-label={`第 ${index + 1} 项增加数量`}
                      disabled={row.quantity >= 99}
                      onClick={() => patch(row.key, { quantity: row.quantity + 1 })}
                    >
                      ＋
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
