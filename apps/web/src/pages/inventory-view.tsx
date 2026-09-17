import { useMemo, useState } from 'react';
import type { InventoryBatch, InventoryCategory, InventoryItem } from '@family/contracts';
import { INVENTORY_CATEGORIES } from '@family/contracts';
import {
  todayISO,
  useAddManualShoppingItem,
  useDeleteInventoryItem,
  useInventory,
  useInventoryBatches,
  useShoppingList,
  useUpsertInventoryItem,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Card, Dialog, SectionTitle } from '../components/ui';
import { BatchDialog, CATEGORY_EMOJI, InventoryEditor } from '../components/inventory-editor';
import { InventoryLog } from '../components/inventory-log';

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'warm' | 'danger' }) {
  const color = !value ? 'text-ink' : tone === 'danger' ? 'text-danger' : tone === 'warm' ? 'text-warm' : 'text-ink';
  return (
    <Card className="flex-1 px-3 py-2.5">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-[12px] text-ink-soft">{label}</p>
    </Card>
  );
}

function batchStatusLabel(batch: InventoryBatch) {
  if (batch.status === 'expired') return `已过期 ${Math.abs(batch.daysRemaining ?? 0)} 天`;
  if (batch.status === 'expiring') return `${batch.daysRemaining} 天后到期`;
  return batch.expiresOn ? `到期 ${batch.expiresOn}` : '未设到期日';
}

export function InventoryView() {
  const { data: items, isPending } = useInventory();
  const { data: batches } = useInventoryBatches('all', 7);
  const { data: shopping } = useShoppingList(todayISO());
  const upsert = useUpsertInventoryItem();
  const remove = useDeleteInventoryItem();
  const addShopping = useAddManualShoppingItem();

  const [filter, setFilter] = useState<'全部' | InventoryCategory>('全部');
  const [editor, setEditor] = useState<InventoryItem | 'new' | null>(null);
  const [batchEditor, setBatchEditor] = useState<InventoryBatch | 'new' | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [restocking, setRestocking] = useState(false);

  const list = items ?? [];
  const low = list.filter((item) => Number(item.quantity) <= Number(item.lowStockThreshold));
  const activeBatches = (batches ?? []).filter((batch) => Number(batch.quantity) > 0);
  const expiring = activeBatches.filter((batch) => batch.status === 'expiring');
  const expired = activeBatches.filter((batch) => batch.status === 'expired');

  // 已经在今天清单里的，不重复加
  const inShopping = useMemo(
    () => new Set((shopping ?? []).map((row) => row.ingredient?.name ?? row.customName ?? '')),
    [shopping],
  );
  const needsShopping = low.filter((item) => !inShopping.has(item.name));

  const groups = useMemo(() => {
    const visible = filter === '全部' ? list : list.filter((item) => item.category === filter);
    const map = new Map<InventoryCategory, InventoryItem[]>();
    for (const item of visible) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [filter, list]);

  const adjust = (item: InventoryItem, offset: number) => {
    const next = Math.max(0, Math.round((Number(item.quantity) + offset) * 100) / 100);
    upsert.mutate({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: next,
      unit: item.unit,
      lowStockThreshold: Number(item.lowStockThreshold),
      restockQuantity: Number(item.restockQuantity),
    });
  };

  const addRestock = async (targets: InventoryItem[]) => {
    if (!targets.length || restocking) return;
    setRestocking(true);
    try {
      for (const item of targets) {
        await addShopping.mutateAsync({
          date: todayISO(),
          customName: item.name,
          totalQty: Number(item.restockQuantity),
          unit: item.unit,
        });
      }
      pushToast(`已把 ${targets.length} 项加进今天的购物清单`);
    } finally {
      setRestocking(false);
    }
  };

  return (
    <>
      <div className="mt-4 flex gap-2">
        <Stat value={list.length} label="库存种类" />
        <Stat value={low.length} label="待补货" tone="warm" />
        <Stat value={expiring.length} label="7 天内到期" tone="warm" />
        <Stat value={expired.length} label="已过期" tone="danger" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button className="h-9 px-3 text-[13px]" onClick={() => setEditor('new')}>
          + 新增库存
        </Button>
        <Button
          variant="outline"
          className="h-9 px-3 text-[13px]"
          disabled={!list.length}
          onClick={() => setBatchEditor('new')}
        >
          登记批次
        </Button>
        {needsShopping.length ? (
          <Button
            variant="outline"
            className="h-9 px-3 text-[13px] text-warm"
            disabled={restocking}
            onClick={() => void addRestock(needsShopping)}
          >
            {restocking ? '加入中…' : `补货 ${needsShopping.length} 项`}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['全部', ...INVENTORY_CATEGORIES] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === filter}
            onClick={() => setFilter(value)}
            className={
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ' +
              (value === filter
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border bg-surface text-ink-soft hover:bg-muted')
            }
          >
            {value === '全部' ? '全部' : `${CATEGORY_EMOJI[value]} ${value}`}
          </button>
        ))}
      </div>

      {activeBatches.length ? (
        <div className="mt-5">
          <SectionTitle>批次与保质期</SectionTitle>
          <Card>
            {activeBatches
              .slice()
              .sort((a, b) =>
                (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31'),
              )
              .map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => setBatchEditor(batch)}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{batch.inventoryItem.name}</p>
                    <p className="mt-0.5 text-[12px] text-ink-soft">
                      {Number(batch.quantity)} {batch.inventoryItem.unit} · 到货 {batch.receivedOn}
                    </p>
                  </div>
                  <span
                    className={
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                      (batch.status === 'expired'
                        ? 'bg-danger/10 text-danger'
                        : batch.status === 'expiring'
                          ? 'bg-warm-soft text-warm'
                          : 'bg-muted text-ink-soft')
                    }
                  >
                    {batchStatusLabel(batch)}
                  </span>
                </button>
              ))}
          </Card>
        </div>
      ) : null}

      {isPending ? <p className="mt-8 px-1 text-sm text-ink-soft">读取中…</p> : null}

      {!isPending && !list.length ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">📦</span>
          <p className="text-sm font-medium">还没有库存记录</p>
          <p className="text-[13px] text-ink-soft">先记下大米、调料和饮料，不够时会提醒补货</p>
        </div>
      ) : null}

      {groups.map(([category, rows]) => (
        <div key={category} className="mt-5">
          <SectionTitle>
            {CATEGORY_EMOJI[category]} {category}
          </SectionTitle>
          <Card>
            {rows.map((item) => {
              const isLow = Number(item.quantity) <= Number(item.lowStockThreshold);
              const queued = inShopping.has(item.name);
              const summary = item.batchSummary;
              return (
                <div
                  key={item.id}
                  className={
                    'flex items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0 ' +
                    (isLow ? 'bg-warm-soft/50' : '')
                  }
                >
                  <button
                    type="button"
                    aria-label={`编辑${item.name}`}
                    onClick={() => setEditor(item)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="text-lg">{CATEGORY_EMOJI[item.category]}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        {isLow ? (
                          <span className="shrink-0 rounded-full bg-warm px-1.5 py-0.5 text-[10px] font-medium text-white">
                            待补货
                          </span>
                        ) : null}
                        {summary?.earliestExpiresOn ? (
                          <span
                            className={
                              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ' +
                              (summary.expiredCount
                                ? 'bg-danger/10 text-danger'
                                : summary.expiringCount
                                  ? 'bg-warm-soft text-warm'
                                  : 'bg-muted text-ink-soft')
                            }
                          >
                            {summary.earliestExpiresOn}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-soft">
                        剩余 {Number(item.quantity)} {item.unit} · 低于{' '}
                        {Number(item.lowStockThreshold)} 提醒
                      </span>
                      {summary?.activeBatchCount ? (
                        <span className="mt-0.5 block text-[11px] text-ink-soft">
                          {summary.activeBatchCount} 个批次 · 未分批 {summary.untrackedQuantity}{' '}
                          {item.unit}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`减少${item.name}`}
                      disabled={Number(item.quantity) <= 0 || upsert.isPending}
                      onClick={() => adjust(item, -1)}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-ink-soft transition-colors duration-150 hover:bg-muted disabled:opacity-40"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`增加${item.name}`}
                      disabled={upsert.isPending}
                      onClick={() => adjust(item, 1)}
                      className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-accent transition-colors duration-150 hover:bg-muted disabled:opacity-40"
                    >
                      +
                    </button>
                    {isLow ? (
                      <button
                        type="button"
                        aria-label={queued ? `${item.name}已在购物清单` : `补货${item.name}`}
                        disabled={queued || restocking}
                        onClick={() => void addRestock([item])}
                        className={
                          'h-8 shrink-0 rounded-lg px-2 text-[12px] font-medium transition-colors duration-150 ' +
                          (queued
                            ? 'bg-muted text-ink-soft'
                            : 'bg-warm-soft text-warm hover:brightness-95')
                        }
                      >
                        {queued ? '已列入' : '补货'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <InventoryLog />

      {editor ? (
        <InventoryEditor
          key={editor === 'new' ? 'new' : editor.id}
          item={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onRequestDelete={(item) => {
            setEditor(null);
            setDeleting(item);
          }}
        />
      ) : null}

      {batchEditor ? (
        <BatchDialog
          key={batchEditor === 'new' ? 'new' : batchEditor.id}
          batch={batchEditor === 'new' ? null : batchEditor}
          inventory={list}
          onClose={() => setBatchEditor(null)}
        />
      ) : null}

      {deleting ? (
        <Dialog
          title={`删除「${deleting.name}」`}
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
                      pushToast(`已删除「${deleting.name}」`);
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
            历史流水会保留。被购物项或资产耗材引用的库存项删不掉，后端会拦。
          </p>
        </Dialog>
      ) : null}
    </>
  );
}
