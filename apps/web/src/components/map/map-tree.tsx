import { useState } from 'react';
import { useCreateLocation, useLocations } from '../../lib/queries';
import { pushToast } from '../../lib/toast';
import { LocationContents } from '../location-contents';
import { LocationNode } from '../location-node';
import { QueryFrame } from '../query-state';
import { ListSkeleton } from '../skeleton';
import { Button, EmptyState, Input } from '../ui';

/**
 * 位置树（I1 的管理页原样搬进地图页左栏，拍板 §6 第 2 条）：房间 → 柜子 / 区域 → 层格。
 * 管理员增改、上下挪、归位、归档；家人看，也能新建（挂在「未整理」下）。
 * withContents：手机「清单」里点一个位置在树下面看放着什么；桌面上内容在地图的抽屉里看。
 */
export function MapTree({
  manager,
  selectedId,
  onSelect,
  withContents,
  narrow = false,
}: {
  /** 桌面地图页左栏：操作按钮只在选中的行出现 */
  narrow?: boolean;
  manager: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  withContents: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const locations = useLocations(showArchived);
  const create = useCreateLocation();
  const [name, setName] = useState('');
  const list = locations.data ?? [];
  const selected = list.find((one) => one.id === selectedId) ?? null;
  const siblingsOf = (parentId: string | null) => list.filter((one) => one.parentId === parentId && !one.archivedAt);

  const submit = () => {
    const value = name.trim();
    if (!value || create.isPending) return;
    create.mutate(
      { parentId: null, name: value },
      {
        onSuccess: (created) => {
          setName('');
          onSelect(created.id);
          if (!manager) pushToast(`「${value}」先放在「未整理」里，管理员回头会归位`, undefined, 'success');
        },
        onError: (error) => pushToast(error.message, undefined, 'error'),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex shrink-0 gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Input
          aria-label={manager ? '新房间名字' : '新位置名字'}
          value={name}
          maxLength={40}
          placeholder={manager ? '加一个房间：厨房、储物间…' : '加一个位置（先放在「未整理」里）'}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" className="shrink-0" disabled={!name.trim() || create.isPending}>
          {create.isPending ? '添加中…' : '添加'}
        </Button>
      </form>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3.5 py-1.5">
          <h2 className="text-[13px] font-semibold text-ink-soft">{list.filter((one) => !one.archivedAt && !one.systemKey).length} 个位置</h2>
          {manager ? (
            <Button variant="ghost" className="min-h-10 px-2 text-[12.5px]" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? '隐藏已归档' : '显示已归档'}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <QueryFrame query={locations} skeleton={<div className="p-3"><ListSkeleton rows={5} /></div>}>
            {list.length ? (
              <ul data-location-tree className="p-2">
                {list.map((location) => (
                  <LocationNode
                    key={location.id}
                    location={location}
                    manager={manager}
                    selected={location.id === selectedId}
                    siblings={siblingsOf(location.parentId)}
                    onSelect={() => onSelect(location.id === selectedId ? null : location.id)}
                    actionsWhenSelected={narrow}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState emoji="🗄️" title="还没记位置" hint="先加几个房间，再在房间里加柜子；入库时就能选「放哪儿」" />
            )}
          </QueryFrame>
        </div>
      </section>
      {withContents && selected ? <LocationContents location={selected} /> : null}
    </div>
  );
}
