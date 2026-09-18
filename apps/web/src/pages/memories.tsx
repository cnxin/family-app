import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FamilyMemory, FamilyMemoryCategory } from '@family/contracts';
import {
  MEMORY_CATEGORY_EMOJI,
  MEMORY_CATEGORY_LABELS,
  memoryDateLabel,
  memoryPhotoSrc,
  useMemories,
} from '../lib/queries';
import { MemoryDetail } from '../components/memory-detail';
import { MemoryEditor } from '../components/memory-editor';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Input, Page, Panel, Segmented } from '../components/ui';

type Status = 'active' | 'archived';
type CategoryFilter = FamilyMemoryCategory | 'all';

const NO_MEMORIES: FamilyMemory[] = [];

export function MemoriesPage() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Status>('active');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<FamilyMemory | null>(null);
  const [editing, setEditing] = useState<FamilyMemory | null>(null);
  const [composing, setComposing] = useState(false);

  const list = useMemories({ status, category, q });
  const rows = list.data ?? NO_MEMORIES;

  // 活动流里的 targetPath 是 /memories?memoryId=…，跳过来要直接把那条打开
  const wanted = params.get('memoryId');
  if (wanted && !selected) {
    const hit = rows.find((one) => one.id === wanted);
    if (hit) {
      setSelected(hit);
      setParams({}, { replace: true });
    }
  }

  // 传完照片列表会重取，详情里拿的还是旧对象，这里用最新的那份盖回去
  const current = selected ? (rows.find((one) => one.id === selected.id) ?? selected) : null;

  return (
    <Page
      title="家庭回忆"
      subtitle="把值得记住的日常留在家里"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setComposing(true)}>
          + 记一条
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              aria-label="搜索回忆"
              placeholder="搜标题或故事"
              className="h-9 w-[180px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setQ(draft);
              }}
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 px-3 text-[13px]"
              onClick={() => setQ(draft)}
            >
              搜索
            </Button>
            {q ? (
              <Button
                variant="ghost"
                className="h-9 shrink-0 px-2 text-[13px]"
                onClick={() => {
                  setDraft('');
                  setQ('');
                }}
              >
                清除
              </Button>
            ) : null}
          </div>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active' as const, label: '珍藏中' },
              { value: 'archived' as const, label: '已归档' },
            ]}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按类别筛选">
            {(['all', ...Object.keys(MEMORY_CATEGORY_LABELS)] as CategoryFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={
                  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
                  (category === value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
                onClick={() => setCategory(value)}
              >
                {value === 'all' ? '全部' : MEMORY_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <Panel className="p-3">
        {list.isPending ? (
          <ListSkeleton rows={3} />
        ) : list.isError ? (
          <EmptyState emoji="📷" title="回忆读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="📷"
            title={q ? '没搜到' : status === 'archived' ? '没有归档的回忆' : '还没有记下什么'}
            hint="从一顿饭、一次出行，或者平常的一天开始"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((memory) => {
              const cover = memory.photos[0];
              return (
                <button
                  key={memory.id}
                  type="button"
                  aria-label={memory.title}
                  onClick={() => setSelected(memory)}
                  className="overflow-hidden rounded-card border border-border text-left transition-colors duration-150 hover:bg-muted"
                >
                  {cover ? (
                    <img
                      src={memoryPhotoSrc(cover.contentUrl)}
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[16/9] w-full place-items-center bg-accent-soft text-3xl">
                      {MEMORY_CATEGORY_EMOJI[memory.category]}
                    </div>
                  )}
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                        {MEMORY_CATEGORY_LABELS[memory.category]}
                      </span>
                      <span className="ml-auto text-[12px] text-ink-soft">
                        {memoryDateLabel(memory.happenedOn)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[15px] font-semibold">{memory.title}</p>
                    {memory.story ? (
                      <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft">{memory.story}</p>
                    ) : null}
                    <p className="mt-2 text-[12px] text-ink-soft">
                      {memory.createdBy.name}
                      {memory.photos.length ? ` · ${memory.photos.length} 张照片` : ''}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {current ? (
        <MemoryDetail
          memory={current}
          onEdit={() => setEditing(current)}
          onArchived={() => setSelected(null)}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {composing || editing ? (
        <MemoryEditor
          editing={editing}
          onSaved={(memory) => {
            setEditing(null);
            setComposing(false);
            setSelected(memory);
          }}
          onClose={() => {
            setEditing(null);
            setComposing(false);
          }}
        />
      ) : null}
    </Page>
  );
}
