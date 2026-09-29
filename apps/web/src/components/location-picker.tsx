import { useMemo, useState } from 'react';
import type { StorageLocation } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { ancestorsOf, rememberLocation, rememberedLocation } from '../lib/location-memory';
import { useCreateLocation, useLocations } from '../lib/queries';
import { Button, Dialog, Input } from './ui';

// 位置选择器（item-location-plan §3 I1、§4）：先房间、再柜子、再层格，每一级都能「就放这儿」结束；顶上能搜；
// 底下能在当前这一层直接新建（家人建的由服务端挂到「未整理」下）。记住上次用的位置，打开时默认高亮它。

const KIND_HINT: Record<StorageLocation['kind'], string> = { room: '房间', zone: '区域', container: '柜子', slot: '层格' };

export function LocationPicker({
  value,
  title = '放哪儿？',
  onPick,
  onClose,
}: {
  /** 现在记着的位置；没有时默认高亮上次用的 */
  value: string | null;
  title?: string;
  /** null = 不记位置 */
  onPick: (location: StorageLocation | null) => void;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const memberId = session?.member.id;
  const manager = session?.member.role !== 'member';
  const locations = useLocations();
  const create = useCreateLocation();
  const list = useMemo(() => locations.data ?? [], [locations.data]);
  const highlight = value ?? rememberedLocation(memberId);
  const [trail, setTrail] = useState<string[] | null>(null);
  const path = trail ?? ancestorsOf(list, highlight);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const byId = new Map(list.map((one) => [one.id, one]));
  const current = path.length ? byId.get(path[path.length - 1]) ?? null : null;
  const children = list.filter((one) => one.parentId === (current?.id ?? null));
  const hasChildren = (id: string) => list.some((one) => one.parentId === id);
  const needle = query.trim().toLowerCase();
  const matches = needle ? list.filter((one) => one.name.toLowerCase().includes(needle)).slice(0, 20) : [];

  const pick = (location: StorageLocation | null) => {
    if (location) rememberLocation(memberId, location.id);
    onPick(location);
  };
  const open = (location: StorageLocation) =>
    hasChildren(location.id) ? setTrail([...ancestorsOf(list, location.id), location.id]) : pick(location);
  const submitNew = () => {
    const name = newName.trim();
    if (!name || create.isPending) return;
    create.mutate({ parentId: current?.id ?? null, name }, { onSuccess: (created) => pick(created) });
  };

  const row = (location: StorageLocation, label = location.name) => (
    <button
      key={location.id}
      type="button"
      data-location-option={location.id}
      aria-current={location.id === highlight || undefined}
      onClick={() => open(location)}
      className={
        'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[14px] transition-colors duration-150 ' +
        (location.id === highlight ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-muted')
      }
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11.5px] text-ink-soft">
        {location.systemKey ? '待整理' : KIND_HINT[location.kind]}
        {hasChildren(location.id) ? ' ›' : ''}
      </span>
    </button>
  );

  return (
    <Dialog
      title={title}
      onClose={onClose}
      maxWidth={420}
      footer={
        <div className="flex flex-col gap-2">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitNew();
            }}
          >
            <Input
              aria-label="新建位置名字"
              value={newName}
              maxLength={40}
              placeholder={current ? `在「${current.name}」里新建` : manager ? '新建一个房间' : '新建一个位置'}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button type="submit" variant="outline" className="shrink-0" disabled={!newName.trim() || create.isPending}>
              {create.isPending ? '建…' : '新建'}
            </Button>
          </form>
          {!manager ? <p className="text-[11.5px] text-ink-soft">你建的位置先放在「未整理」里，管理员回头会归位</p> : null}
          {create.isError ? <p role="alert" className="text-[12px] text-danger">{(create.error as Error).message}</p> : null}
          {value ? (
            <Button variant="ghost" className="text-ink-soft" onClick={() => pick(null)}>
              不记位置
            </Button>
          ) : null}
        </div>
      }
    >
      <div data-location-picker className="flex flex-col gap-3">
        <Input
          aria-label="搜位置"
          value={query}
          placeholder="搜：吊柜、冰箱…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {needle ? (
          <div className="flex flex-col gap-1.5">
            {matches.length ? matches.map((one) => row(one, one.pathLabel)) : <p className="text-[13px] text-ink-soft">没有叫这个的位置，可以在下面新建</p>}
          </div>
        ) : (
          <>
            <nav aria-label="位置层级" className="flex flex-wrap items-center gap-1 text-[13px]">
              <button type="button" className="rounded px-1 text-accent hover:underline" onClick={() => setTrail([])}>
                全部
              </button>
              {path.map((id, index) => (
                <span key={id} className="flex items-center gap-1">
                  <span className="text-ink-soft">/</span>
                  <button type="button" className="rounded px-1 text-accent hover:underline" onClick={() => setTrail(path.slice(0, index + 1))}>
                    {byId.get(id)?.name ?? '…'}
                  </button>
                </span>
              ))}
            </nav>
            {current ? (
              <Button className="w-full" onClick={() => pick(current)}>
                就放在「{current.name}」
              </Button>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {locations.isPending ? <p className="text-[13px] text-ink-soft">读取中…</p> : null}
              {children.map((one) => row(one))}
              {!locations.isPending && !children.length ? (
                <p className="text-[13px] text-ink-soft">{current ? '这里面还没分格，直接「就放在这儿」就行' : '还没有位置，在下面建一个房间或柜子'}</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
