import type { StorageLocation, StorageLocationContents } from '@family/contracts';
import { useLocationContents } from '../../lib/queries';
import { QueryFrame } from '../query-state';
import { ListSkeleton } from '../skeleton';
import { SoftLink } from '../soft-link';
import { ASSET_EMOJI } from '../location-contents';

// 看模式点了房间 / 柜子之后的内容（手机在底部抽屉里，桌面在地图右侧）：
// 房间列它的柜子 / 区域和直接放在房间里的东西；柜子列层格和里面的东西。口径都是「上次放在」。

type Row = { key: string; name: string; detail: string | null; to: string | null; emoji?: string };

function rowsAt(data: StorageLocationContents, locationId: string): Row[] {
  return [
    ...data.batches
      .filter((one) => one.locationId === locationId)
      .map((one) => ({
        key: `b${one.id}`,
        name: one.itemName,
        detail: `${Number(one.quantity)} ${one.unit}${one.expiresOn ? ` · 到期 ${one.expiresOn}` : ''}`,
        to: `/house/inventory`,
      })),
    ...data.items
      .filter((one) => one.locationId === locationId && !data.batches.some((b) => b.inventoryItemId === one.id && b.locationId === locationId))
      .map((one) => ({ key: `i${one.id}`, name: one.name, detail: `${Number(one.quantity)} ${one.unit}`, to: '/house/inventory' })),
    ...data.assets
      .filter((one) => one.locationId === locationId)
      .map((one) => ({ key: `a${one.id}`, name: one.name, detail: null, to: `/house/assets/${one.id}`, emoji: ASSET_EMOJI[one.category] ?? '📦' })),
  ];
}

function Rows({ rows, hitNames }: { rows: Row[]; hitNames?: Set<string> }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.key}>
          <SoftLink
            to={row.to ?? '#'}
            className={
              'flex min-h-11 items-center gap-2 rounded-lg px-2 text-[14.5px] transition-colors duration-150 hover:bg-muted ' +
              (hitNames?.has(row.name) ? 'bg-warm-soft' : '')
            }
          >
            {row.emoji ? <span aria-hidden="true">{row.emoji}</span> : null}
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {row.detail ? <span className="shrink-0 text-[12px] text-ink-soft">{row.detail}</span> : null}
          </SoftLink>
        </li>
      ))}
    </ul>
  );
}

export function MapDrawer({
  location,
  locations,
  hitIds,
  hitNames,
  onPick,
}: {
  location: StorageLocation;
  locations: StorageLocation[];
  /** 搜索命中的位置：子位置列表里标出来 */
  hitIds?: Set<string>;
  hitNames?: Set<string>;
  onPick: (id: string) => void;
}) {
  const contents = useLocationContents(location.id);
  const children = locations.filter((one) => one.parentId === location.id && !one.archivedAt);
  const data = contents.data;
  /** 柜子连同它的层格一共记了几样（itemCount 只数直接放的） */
  const countUnder = (id: string) => {
    if (!data) return locations.find((one) => one.id === id)?.itemCount ?? 0;
    const ids = new Set([id, ...locations.filter((one) => one.parentId === id).map((one) => one.id)]);
    return [...data.items, ...data.batches, ...data.assets].filter((one) => ids.has(one.locationId)).length;
  };
  const direct = data ? rowsAt(data, location.id) : [];
  const total = data ? data.items.length + data.batches.length + data.assets.length : 0;
  const isRoom = location.kind === 'room';

  return (
    <div data-map-drawer={location.id} className="flex flex-col gap-4">
      {children.length ? (
        <section>
          <h3 className="mb-1 text-[12px] font-medium text-ink-soft">{isRoom ? '柜子和区域' : '层格'}</h3>
          <ul className="flex flex-col">
            {children.map((child) => {
              const slotRows = !isRoom && data ? rowsAt(data, child.id) : [];
              return (
                <li key={child.id}>
                  {isRoom ? (
                    <button
                      type="button"
                      onClick={() => onPick(child.id)}
                      className={
                        'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14.5px] transition-colors duration-150 hover:bg-muted ' +
                        (hitIds?.has(child.id) ? 'bg-warm-soft' : '')
                      }
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{child.name}</span>
                      <span className="shrink-0 text-[12px] text-ink-soft">
                        {child.mapShape ? '' : '没上图 · '}
                        {countUnder(child.id) ? `${countUnder(child.id)} 样` : '空'}
                      </span>
                      <span aria-hidden="true" className="text-ink-soft">›</span>
                    </button>
                  ) : (
                    <div className="py-1">
                      <p className="px-2 text-[13px] font-medium">{child.name}</p>
                      {slotRows.length ? <Rows rows={slotRows} hitNames={hitNames} /> : <p className="px-2 text-[12.5px] text-ink-soft">没记东西</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <QueryFrame query={contents} skeleton={<ListSkeleton rows={3} />}>
        <section>
          <h3 className="mb-1 text-[12px] font-medium text-ink-soft">{isRoom ? '直接放在房间里的' : children.length ? '没分层的' : '上次放在这里的'}</h3>
          {direct.length ? (
            <Rows rows={direct} hitNames={hitNames} />
          ) : (
            <p className="px-2 py-2 text-[13px] text-ink-soft">
              {total ? '都在下面的柜子里' : '这里还没记东西。入库时选这个位置，或在库存里点「上次放在」改过来。'}
            </p>
          )}
        </section>
      </QueryFrame>
    </div>
  );
}
