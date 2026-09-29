import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useCreateLocation, useLocations } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { LocationContents } from '../components/location-contents';
import { LocationNode } from '../components/location-node';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Input, Page, Panel } from '../components/ui';

/**
 * /house/locations：位置字典（item-location-plan §3 I1）。先只做树：房间 → 柜子 / 区域 → 层格，
 * 点一个位置看它下面记着什么。管理员增改、上下挪、归位、归档；家人看，也能新建（挂在「未整理」下）。
 * 地图（左树右图）是 I2 的事。
 */
export function LocationsPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const [showArchived, setShowArchived] = useState(false);
  const locations = useLocations(showArchived);
  const create = useCreateLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
          setSelectedId(created.id);
          if (!manager) pushToast(`「${value}」先放在「未整理」里，管理员回头会归位`);
        },
        onError: (error) => pushToast(error.message),
      },
    );
  };

  return (
    <Page
      title="物品位置"
      subtitle="东西上次放在哪：房间 → 柜子 → 层格，最多三层"
      actions={
        manager ? (
          <Button variant="ghost" className="min-h-11" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? '隐藏已归档' : '显示已归档'}
          </Button>
        ) : null
      }
      toolbar={
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
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
      }
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        <Panel title={`${list.filter((one) => !one.archivedAt && !one.systemKey).length} 个位置`} className="lg:flex-1">
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
                    onSelect={() => setSelectedId(location.id === selectedId ? null : location.id)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState emoji="🗄️" title="还没记位置" hint="先加几个房间，再在房间里加柜子；入库时就能选「放哪儿」" />
            )}
          </QueryFrame>
        </Panel>
        {selected ? (
          <div className="lg:sticky lg:top-4 lg:w-[360px] lg:flex-none">
            <LocationContents location={selected} />
          </div>
        ) : null}
      </div>
    </Page>
  );
}
