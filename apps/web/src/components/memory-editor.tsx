import { useState } from 'react';
import type { FamilyMemory, FamilyMemoryCategory } from '@family/contracts';
import {
  MEMORY_CATEGORY_LABELS,
  memoryKey,
  todayISO,
  useSaveMemory,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');
const textarea =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

function parseTags(raw: string) {
  return [...new Set(raw.split(/[，,]/).map((one) => one.trim()).filter(Boolean))].slice(0, 8);
}

export function MemoryEditor({
  editing,
  onSaved,
  onClose,
}: {
  editing: FamilyMemory | null;
  onSaved: (memory: FamilyMemory) => void;
  onClose: () => void;
}) {
  const save = useSaveMemory();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [happenedOn, setHappenedOn] = useState(editing?.happenedOn ?? todayISO());
  const [category, setCategory] = useState<FamilyMemoryCategory>(editing?.category ?? 'daily');
  const [story, setStory] = useState(editing?.story ?? '');
  const [tagText, setTagText] = useState((editing?.tags ?? []).join('，'));
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey] = useState(() =>
    memoryKey(editing ? `memory:update:${editing.id}` : 'memory:create'),
  );

  function submit() {
    if (!title.trim()) return setMessage('先写一句标题');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        expectedVersion: editing?.version,
        idempotencyKey,
        body: {
          title: title.trim(),
          happenedOn,
          category,
          story: story.trim() || null,
          tags: parseTags(tagText),
        },
      },
      {
        onSuccess: (memory) => {
          pushToast(editing ? '这条回忆已更新' : '记下了');
          onSaved(memory);
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '记一条回忆'}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存修改' : '保存回忆'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">文字和照片只有家里人看得到。</p>

        <label className="block">
          <span className={label}>标题</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="标题"
            placeholder="今天发生了什么"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>哪一天</span>
            <Input
              type="date"
              value={happenedOn}
              aria-label="回忆日期"
              onChange={(event) => setHappenedOn(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>标签（选填）</span>
            <Input
              value={tagText}
              maxLength={200}
              aria-label="标签"
              placeholder="周末，第一次，团聚"
              onChange={(event) => setTagText(event.target.value)}
            />
          </label>
        </div>

        <div>
          <span className={label}>类别</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MEMORY_CATEGORY_LABELS) as FamilyMemoryCategory[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={chip(category === value)}
                onClick={() => setCategory(value)}
              >
                {MEMORY_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={label}>那天的事（选填）</span>
          <textarea
            value={story}
            rows={5}
            maxLength={5000}
            aria-label="故事"
            placeholder="写下当时的人、事和心情"
            className={textarea}
            onChange={(event) => setStory(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
