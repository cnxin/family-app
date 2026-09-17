import { useMemo, useState } from 'react';
import type { ShoppingItem } from '@family/contracts';
import { Link } from 'react-router-dom';
import {
  todayISO,
  useAddManualShoppingItem,
  useCheckShoppingItem,
  useDeleteShoppingItem,
  useGenerateShoppingList,
  useShoppingList,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Card, Checkbox, Dialog, EmptyState, Input, Page, Panel, SectionTitle } from '../components/ui';
import { StockDialog } from '../components/stock-dialog';
import { ListSkeleton } from '../components/skeleton';

function num(value: string | null | undefined) {
  return value == null ? 0 : Number(value);
}

function itemName(item: ShoppingItem) {
  return item.ingredient?.name ?? item.customName ?? '未知';
}

/**
 * 自动项要把「需要多少 / 现有多少 / 建议买多少」摊开写。
 * 旧客户端这行是家里人最常看的一行——只写「买 2 斤」没人知道为什么是 2 斤。
 */
function breakdownOf(item: ShoppingItem) {
  const auto = item.source === 'auto' || item.source === 'maintenance';
  if (!auto || item.requiredQty == null || item.availableQty == null) return null;
  const unit = item.unit ? ` ${item.unit}` : '';
  const prefix = item.source === 'maintenance' ? '资产维护 · ' : '';
  return `${prefix}需要 ${num(item.requiredQty)}${unit} · 库存 ${num(item.availableQty)}${unit} · 建议买 ${num(item.totalQty)}${unit}`;
}

function ItemRow({
  item,
  onStock,
  onDelete,
}: {
  item: ShoppingItem;
  onStock: () => void;
  onDelete: () => void;
}) {
  const check = useCheckShoppingItem();
  const name = itemName(item);
  const breakdown = breakdownOf(item);
  const confirmation = item.inventoryConfirmation;

  return (
    <div className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="pt-0.5">
        <Checkbox
          checked={item.checked}
          disabled={check.isPending}
          label={`${item.checked ? '取消勾选' : '勾选'}${name}`}
          onChange={() => check.mutate({ id: item.id, checked: !item.checked })}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={
            'text-sm ' + (item.checked ? 'text-ink-soft line-through' : 'font-medium text-ink')
          }
        >
          {name}
        </p>
        {breakdown ? (
          <p className="mt-0.5 text-[12px] text-ink-soft">{breakdown}</p>
        ) : item.totalQty ? (
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {num(item.totalQty)} {item.unit ?? ''}
          </p>
        ) : null}
      </div>

      {confirmation ? (
        <span
          className={
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
            (confirmation.reversedAt ? 'bg-muted text-ink-soft' : 'bg-accent-soft text-accent')
          }
        >
          {confirmation.reversedAt ? '入库已撤销' : `已入库 +${num(confirmation.delta)}`}
        </span>
      ) : item.checked ? (
        <Button
          variant="outline"
          className="h-8 shrink-0 px-2.5 text-[12px] text-accent"
          onClick={onStock}
        >
          入库
        </Button>
      ) : null}

      <button
        type="button"
        aria-label={`删除${name}`}
        onClick={onDelete}
        className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
      >
        🗑
      </button>
    </div>
  );
}

/** 手动添加：垃圾袋、酱油这类不在菜单里的东西。 */
function ManualAdd({ date }: { date: string }) {
  const add = useAddManualShoppingItem();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('份');

  const parsed = Number(qty);
  const valid = Boolean(name.trim()) && Number.isFinite(parsed) && parsed > 0 && Boolean(unit.trim());

  const step = (offset: number) => {
    const next = Math.max(0.1, Math.round(((Number(qty) || 1) + offset) * 10) / 10);
    setQty(String(next));
  };

  const submit = () => {
    if (!valid || add.isPending) return;
    const trimmed = name.trim();
    add.mutate(
      { date, customName: trimmed, totalQty: parsed, unit: unit.trim() },
      {
        onSuccess: () => {
          setName('');
          setQty('1');
          pushToast(`已添加「${trimmed}」`);
        },
      },
    );
  };

  return (
    <>
      <SectionTitle>添加物品</SectionTitle>
      <Card className="p-3">
        <Input
          value={name}
          placeholder="比如：垃圾袋、酱油"
          aria-label="物品名称"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-10 items-center rounded-lg border border-border bg-surface">
            <button
              type="button"
              aria-label="减少数量"
              disabled={parsed <= 0.1}
              onClick={() => step(-1)}
              className="grid size-9 place-items-center rounded-l-lg text-ink-soft transition-colors duration-150 hover:bg-muted disabled:opacity-40"
            >
              −
            </button>
            <input
              aria-label="数量"
              inputMode="decimal"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              className="h-full w-12 bg-transparent text-center text-sm text-ink focus:outline-none"
            />
            <button
              type="button"
              aria-label="增加数量"
              onClick={() => step(1)}
              className="grid size-9 place-items-center rounded-r-lg text-accent transition-colors duration-150 hover:bg-muted"
            >
              +
            </button>
          </div>
          <div className="w-20 shrink-0">
            <Input
              aria-label="单位"
              value={unit}
              placeholder="份"
              onChange={(event) => setUnit(event.target.value)}
            />
          </div>
          <Button
            className="ml-auto shrink-0 whitespace-nowrap"
            disabled={!valid || add.isPending}
            onClick={submit}
          >
            {add.isPending ? '添加中…' : '添加'}
          </Button>
        </div>
      </Card>
    </>
  );
}

export function ShoppingView() {
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [stocking, setStocking] = useState<ShoppingItem | null>(null);
  const [deleting, setDeleting] = useState<ShoppingItem | null>(null);

  const list = useShoppingList(date);
  const remove = useDeleteShoppingItem();
  const generate = useGenerateShoppingList();

  const items = list.data ?? [];
  const done = items.filter((item) => item.checked).length;

  // 分组照旧客户端：维护耗材单独一组，其余按食材分类，手动项兜底
  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items) {
      const key =
        item.source === 'maintenance'
          ? '维护耗材'
          : (item.ingredient?.category ?? '手动添加');
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Page
      title="购物清单"
      subtitle="这天要买什么，买回来记得入库"
      actions={
        <Button
          variant="outline"
          className="h-9 px-3 text-[13px]"
          disabled={generate.isPending}
          onClick={() =>
            generate.mutate(date, {
              onSuccess: (next) =>
                pushToast(
                  next.length
                    ? `清单已刷新：共 ${next.length} 项`
                    : '这天接单的菜都不缺食材（常备调料不进清单）',
                ),
            })
          }
        >
          {generate.isPending ? '生成中…' : '按菜单重算'}
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="选择日期"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          {date === today ? null : (
            <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setDate(today)}>
              回今天
            </Button>
          )}
          {items.length ? (
            <span className="text-[13px] text-ink-soft">
              已买 {done}/{items.length}
            </span>
          ) : null}
        </div>
      }
    >
      <Panel title={`${items.length} 件要买`}>
        {list.isPending ? (
          <div className="p-3">
            <ListSkeleton rows={4} />
          </div>
        ) : !items.length ? (
          <EmptyState
            emoji="🧾"
            title="清单是空的"
            hint={
              <>
                去
                <Link to="/eat/kitchen" className="mx-1 text-accent">
                  厨房
                </Link>
                接单后生成，或在右边手动添加
              </>
            }
          />
        ) : (
          groups.map(([category, rows]) => (
            <div key={category}>
              <p className="sticky top-0 z-10 border-b border-border bg-surface/90 px-3.5 py-1.5 text-[12px] font-medium text-ink-soft backdrop-blur">
                {category}
              </p>
              {rows.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onStock={() => setStocking(item)}
                  onDelete={() => setDeleting(item)}
                />
              ))}
            </div>
          ))
        )}
      </Panel>

      <aside className="min-w-0 lg:w-[320px] lg:flex-none">
        <ManualAdd date={date} />
      </aside>

      {stocking ? <StockDialog item={stocking} onClose={() => setStocking(null)} /> : null}

      {deleting ? (
        <Dialog
          title={`删除「${itemName(deleting)}」`}
          onClose={() => setDeleting(null)}
          maxWidth={380}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button
                className="flex-1 bg-danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      pushToast(`已删除「${itemName(deleting)}」`);
                      setDeleting(null);
                    },
                  })
                }
              >
                删除
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">
            {deleting.source === 'auto'
              ? '这是按菜单自动生成的一项，删掉之后「按菜单重算」还会再出现。'
              : '删掉后不可恢复。'}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
