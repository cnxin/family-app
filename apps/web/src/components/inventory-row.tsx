import type { InventoryItem } from '@family/contracts';
import { CATEGORY_EMOJI } from './inventory-editor';
import { LocationLine } from './location-field';

/**
 * 库存列表的一行：点名字编辑，± 调余量，低于阈值出「补货」。
 * I1：名字下面一行「上次放在 …」，点了直接开选择器改默认位置（不进编辑页）。
 */
export function InventoryRow({
  item,
  queued,
  adjusting,
  restocking,
  locating,
  emptyLocationLabel,
  onEdit,
  onAdjust,
  onRestock,
  onLocate,
}: {
  item: InventoryItem;
  /** 已经在今天的购物清单里 */
  queued: boolean;
  adjusting: boolean;
  restocking: boolean;
  locating: boolean;
  /** 按位置分组时「没记位置」那一组给一个一跳记上的入口；其余时候没位置就什么都不显示 */
  emptyLocationLabel?: string;
  onEdit: () => void;
  onAdjust: (offset: number) => void;
  onRestock: () => void;
  onLocate: (locationId: string | null) => void;
}) {
  const isLow = Number(item.quantity) <= Number(item.lowStockThreshold);
  const summary = item.batchSummary;
  return (
    <div
      data-inventory-row={item.id}
      className={'flex items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0 ' + (isLow ? 'bg-warm-soft/50' : '')}
    >
      <span className="text-lg" aria-hidden="true">{CATEGORY_EMOJI[item.category]}</span>
      <div className="min-w-0 flex-1">
        <button type="button" aria-label={`编辑${item.name}`} onClick={onEdit} className="block w-full min-w-0 text-left">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {isLow ? (
              <span className="shrink-0 rounded-full bg-warm px-1.5 py-0.5 text-[10px] font-medium text-on-warm">待补货</span>
            ) : null}
            {summary?.earliestExpiresOn ? (
              <span
                className={
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ' +
                  (summary.expiredCount ? 'bg-danger/10 text-danger' : summary.expiringCount ? 'bg-warm-soft text-warm' : 'bg-muted text-ink-soft')
                }
              >
                {summary.earliestExpiresOn}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[12px] text-ink-soft">
            剩余 {Number(item.quantity)} {item.unit} · 低于 {Number(item.lowStockThreshold)} 提醒
          </span>
          {summary?.activeBatchCount ? (
            <span className="mt-0.5 block text-[11px] text-ink-soft">
              {summary.activeBatchCount} 个批次 · 未分批 {summary.untrackedQuantity} {item.unit}
            </span>
          ) : null}
        </button>
        <LocationLine
          locationId={item.defaultLocationId}
          name={item.name}
          pending={locating}
          emptyLabel={emptyLocationLabel}
          onChange={onLocate}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`减少${item.name}`}
          disabled={Number(item.quantity) <= 0 || adjusting}
          onClick={() => onAdjust(-1)}
          className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-soft transition-colors duration-150 hover:bg-muted disabled:opacity-40"
        >
          −
        </button>
        <button
          type="button"
          aria-label={`增加${item.name}`}
          disabled={adjusting}
          onClick={() => onAdjust(1)}
          className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-accent transition-colors duration-150 hover:bg-muted disabled:opacity-40"
        >
          +
        </button>
        {isLow ? (
          <button
            type="button"
            aria-label={queued ? `${item.name}已在购物清单` : `补货${item.name}`}
            disabled={queued || restocking}
            onClick={onRestock}
            className={
              'h-8 shrink-0 rounded-lg px-2 text-[12px] font-medium transition-colors duration-150 ' +
              (queued ? 'bg-muted text-ink-soft' : 'bg-warm-soft text-warm hover:brightness-95')
            }
          >
            {queued ? '已列入' : '补货'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
