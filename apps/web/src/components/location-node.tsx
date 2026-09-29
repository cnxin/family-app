import { useState } from 'react';
import type { StorageLocation, StorageLocationKind } from '@family/contracts';
import { STORAGE_LOCATION_MAX_DEPTH } from '@family/contracts';
import { useArchiveLocation, useCreateLocation, useDeleteLocation, useUpdateLocation } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { LocationPicker } from './location-picker';
import { Button, Dialog, Input } from './ui';

const KIND_LABEL: Record<StorageLocationKind, string> = { room: '房间', zone: '区域', container: '柜子', slot: '层格' };

const small =
  'min-h-9 rounded-lg px-2 text-[12.5px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink disabled:opacity-40';

/** 下一层能建什么：房间下柜子或区域，柜子下层格，区域和层格下不再分。 */
export function childKinds(location: StorageLocation): StorageLocationKind[] {
  if (location.archivedAt || location.depth >= STORAGE_LOCATION_MAX_DEPTH) return [];
  if (location.kind === 'room') return location.systemKey ? ['zone'] : ['container', 'zone'];
  return location.kind === 'container' ? ['slot'] : [];
}

/** 管理页树上的一行：名字、类型、直接放着几样；管理员能加下一层、改名、上下挪、归位、归档、删。 */
export function LocationNode({
  location,
  manager,
  selected,
  siblings,
  onSelect,
  actionsWhenSelected = false,
}: {
  /** 窄栏（地图页左树）：操作按钮只在选中的那行出现，免得名字被挤掉 */
  actionsWhenSelected?: boolean;
  location: StorageLocation;
  manager: boolean;
  selected: boolean;
  /** 同一层的兄弟（含自己），按显示顺序，用来上下挪 */
  siblings: StorageLocation[];
  onSelect: () => void;
}) {
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const archive = useArchiveLocation();
  const remove = useDeleteLocation();
  const [adding, setAdding] = useState<StorageLocationKind | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState('');
  const archived = Boolean(location.archivedAt);
  const system = Boolean(location.systemKey);
  const index = siblings.findIndex((one) => one.id === location.id);
  const fail = (error: Error) => pushToast(error.message);

  const swap = (offset: -1 | 1) => {
    const other = siblings[index + offset];
    if (!other) return;
    // 兄弟的 sortOrder 可能相同（名字排序兜底）：按位置重新编号，只改这两个
    update.mutate({ id: location.id, sortOrder: index + offset }, { onError: fail });
    update.mutate({ id: other.id, sortOrder: index }, { onError: fail });
  };
  const submitName = () => {
    const value = name.trim();
    if (!value) return;
    if (adding) {
      create.mutate({ parentId: location.id, kind: adding, name: value }, { onSuccess: () => setAdding(null), onError: fail });
    } else {
      update.mutate({ id: location.id, name: value }, { onSuccess: () => setRenaming(false), onError: fail });
    }
  };

  return (
    <li data-location-node={location.id} data-depth={location.depth} className={archived ? 'opacity-50' : ''}>
      <div
        className={
          'flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg py-1 pr-1 transition-colors duration-150 ' +
          (selected ? 'bg-accent-soft' : 'hover:bg-muted')
        }
        style={{ paddingLeft: `${(location.depth - 1) * 20 + 8}px` }}
      >
        {/* 手机上名字独占一行、操作换到下一行，免得名字被挤成一个字 */}
        <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-h-10 w-full min-w-0 items-center gap-2 text-left sm:w-auto sm:flex-1">
          <span className="truncate text-[14.5px] font-medium">{location.name}</span>
          <span className="shrink-0 text-[11.5px] text-ink-soft">
            {system ? '家人新建的先放这儿' : KIND_LABEL[location.kind]}
            {archived ? ' · 已归档' : ''}
            {location.itemCount ? ` · ${location.itemCount} 样` : ''}
          </span>
        </button>
        {manager && !archived && (!actionsWhenSelected || selected) ? (
          <span className="-mt-1 flex flex-wrap items-center sm:mt-0">
            {childKinds(location).map((kind) => (
              <button key={kind} type="button" className={small} onClick={() => { setName(''); setRenaming(false); setAdding(kind); }}>
                +{KIND_LABEL[kind]}
              </button>
            ))}
            {!system ? (
              <>
                <button type="button" className={small} onClick={() => { setName(location.name); setAdding(null); setRenaming(true); }}>改名</button>
                <button type="button" aria-label={`${location.name}上移`} className={small} disabled={index <= 0} onClick={() => swap(-1)}>↑</button>
                <button type="button" aria-label={`${location.name}下移`} className={small} disabled={index >= siblings.length - 1} onClick={() => swap(1)}>↓</button>
                {location.depth > 1 ? <button type="button" className={small} onClick={() => setMoving(true)}>挪到…</button> : null}
                <button type="button" className={small} onClick={() => setConfirmArchive(true)}>归档</button>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {adding || renaming ? (
        <form
          className="flex gap-2 py-1.5 pr-1"
          style={{ paddingLeft: `${location.depth * 20 + 8}px` }}
          onSubmit={(event) => { event.preventDefault(); submitName(); }}
        >
          <Input autoFocus aria-label={adding ? `新${KIND_LABEL[adding]}名字` : '新名字'} value={name} maxLength={40}
            placeholder={adding ? `在「${location.name}」里加一个${KIND_LABEL[adding]}` : '新名字'} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" className="shrink-0" disabled={!name.trim() || create.isPending || update.isPending}>好</Button>
          <Button type="button" variant="ghost" className="shrink-0" onClick={() => { setAdding(null); setRenaming(false); }}>取消</Button>
        </form>
      ) : null}
      {moving ? (
        <LocationPicker
          value={location.parentId}
          title={`把「${location.name}」挪到哪个房间或柜子里？`}
          onClose={() => setMoving(false)}
          onPick={(target) => {
            setMoving(false);
            if (target) update.mutate({ id: location.id, parentId: target.id }, { onSuccess: () => pushToast(`已挪到「${target.pathLabel}」`), onError: fail });
          }}
        />
      ) : null}
      {confirmArchive ? (
        <Dialog
          title={`归档「${location.name}」`}
          onClose={() => setConfirmArchive(false)}
          maxWidth={380}
          footer={
            <div className="flex gap-2">
              {!location.itemCount ? (
                <Button variant="ghost" className="text-danger" disabled={remove.isPending}
                  onClick={() => remove.mutate(location.id, { onSuccess: () => setConfirmArchive(false), onError: fail })}>
                  直接删掉
                </Button>
              ) : null}
              <Button className="ml-auto" disabled={archive.isPending}
                onClick={() => archive.mutate(location.id, { onSuccess: () => { setConfirmArchive(false); pushToast(`已归档「${location.name}」`); }, onError: fail })}>
                归档
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">
            归档后选择器里不再出现，下面的位置一起归档。已经记在这儿的东西照样显示「上次放在」这里。
            {location.itemCount ? '' : '从没用过的位置也可以直接删掉（下面还有位置时删不了）。'}
          </p>
        </Dialog>
      ) : null}
    </li>
  );
}
