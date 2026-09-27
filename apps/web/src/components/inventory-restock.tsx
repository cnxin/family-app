import type { InventoryItem } from '@family/contracts';
import { Button, Card, SectionTitle } from './ui';
import { CATEGORY_EMOJI } from './inventory-editor';

/**
 * 「现在要买什么」单独成一框。
 * 左边那份列表回答的是「家里有什么」，全展开的时候低库存那几条会被淹掉，
 * 而每天真正要看一眼的其实是这一框。
 */
export function RestockPanel({
  low,
  pending,
  busy,
  onRestock,
}: {
  /** 所有低于阈值的库存项 */
  low: InventoryItem[];
  /** 其中还没进今天购物清单的 */
  pending: InventoryItem[];
  busy: boolean;
  onRestock: (items: InventoryItem[]) => void;
}) {
  if (!low.length) return null;
  const queuedNames = new Set(low.map((one) => one.name));
  for (const one of pending) queuedNames.delete(one.name);

  return (
    <div>
      <SectionTitle
        right={
          pending.length ? (
            <Button
              variant="ghost"
              className="h-7 px-2 text-[12px] text-warm"
              disabled={busy}
              onClick={() => onRestock(pending)}
            >
              {busy ? '加入中…' : `全部加进清单 ${pending.length}`}
            </Button>
          ) : (
            <span className="text-[11.5px] text-ink-soft">都已列入清单</span>
          )
        }
      >
        需要补货 · {low.length} 项
      </SectionTitle>
      <Card>
        {low.map((item, index) => {
          const queued = queuedNames.has(item.name);
          return (
            <div
              key={item.id}
              className={
                'flex items-center gap-2 px-3 py-2 ' + (index ? 'border-t border-border' : '')
              }
            >
              <span className="text-[15px]">{CATEGORY_EMOJI[item.category]}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{item.name}</p>
                <p className="text-[11.5px] text-ink-soft">
                  剩 {Number(item.quantity)} {item.unit} · 建议补 {Number(item.restockQuantity)}{' '}
                  {item.unit}
                </p>
              </div>
              <button
                type="button"
                aria-label={queued ? `${item.name}已在购物清单` : `补货${item.name}`}
                disabled={queued || busy}
                onClick={() => onRestock([item])}
                className={
                  'h-7 shrink-0 rounded-lg px-2 text-[12px] font-medium transition-colors duration-150 ' +
                  (queued ? 'bg-muted text-ink-soft' : 'bg-warm-soft text-warm hover:brightness-95')
                }
              >
                {queued ? '已列入' : '补货'}
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
