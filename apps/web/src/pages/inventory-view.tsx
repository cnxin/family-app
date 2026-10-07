import { useMemo, useState } from 'react';
import type { InventoryBatch, InventoryCategory, InventoryItem } from '@family/contracts';
import { INVENTORY_CATEGORIES } from '@family/contracts';
import {
  todayISO,
  useAddManualShoppingItem,
  useDeleteInventoryItem,
  useInventory,
  useInventoryBatches,
  useLocations,
  useSetLocation,
  useShoppingList,
  useUpsertInventoryItem,
} from '../lib/queries';
import { groupInventory, type InventoryGrouping } from '../lib/inventory-groups';
import { pushToast } from '../lib/toast';
import { QueryFrame } from '../components/query-state';
import { Button, Card, Dialog, EmptyState, Page, Panel, SectionTitle, Segmented } from '../components/ui';
import { InventoryRow } from '../components/inventory-row';
import { LocationLine } from '../components/location-field';
import { LocateItemFlow } from '../components/locate-item';
import { BatchDialog, CATEGORY_EMOJI, InventoryEditor } from '../components/inventory-editor';
import { InventoryLog } from '../components/inventory-log';
import { RestockPanel } from '../components/inventory-restock';
import { ListSkeleton } from '../components/skeleton';

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

const NO_ITEMS: InventoryItem[] = [];

export function InventoryView() {
  const inventory = useInventory();
  const { data: items } = inventory;
  const { data: batches } = useInventoryBatches('all', 7);
  const { data: shopping } = useShoppingList(todayISO());
  const upsert = useUpsertInventoryItem();
  const remove = useDeleteInventoryItem();
  const addShopping = useAddManualShoppingItem();

  const [filter, setFilter] = useState<'全部' | InventoryCategory>('全部');
  const [grouping, setGrouping] = useState<InventoryGrouping>('category');
  const locations = useLocations(true);
  const setLocation = useSetLocation();
  const [editor, setEditor] = useState<InventoryItem | 'new' | null>(null);
  const [preset, setPreset] = useState<{ name: string; locationId: string } | null>(null);
  const [batchEditor, setBatchEditor] = useState<InventoryBatch | 'new' | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [restocking, setRestocking] = useState(false);

  const list = items ?? NO_ITEMS;
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
    return groupInventory(visible, grouping, locations.data ?? []);
  }, [filter, list, grouping, locations.data]);

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
      pushToast(`已把 ${targets.length} 项加进今天的购物清单`, undefined, 'success');
    } finally {
      setRestocking(false);
    }
  };

  return (
    <Page
      title="家庭库存"
      subtitle="家里还有什么，不够了会提醒补货"
      actions={
        <div className="flex flex-wrap items-center gap-2">
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
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Stat value={list.length} label="库存种类" />
            <Stat value={low.length} label="待补货" tone="warm" />
            <Stat value={expiring.length} label="7 天内到期" tone="warm" />
            <Stat value={expired.length} label="已过期" tone="danger" />
          </div>
          <Segmented<InventoryGrouping>
            label="分组方式"
            value={grouping}
            options={[
              { value: 'category', label: '按类别' },
              { value: 'location', label: '按位置' },
            ]}
            onChange={setGrouping}
          />
          <div className="flex flex-wrap gap-1.5">
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
        </div>
      }
    >
      <Panel title={`${list.length} 种`}>
      <QueryFrame query={inventory} skeleton={<div className="p-3"><ListSkeleton rows={5} /></div>}>
      {!list.length ? (
        <EmptyState emoji="📦" title="还没有库存记录" hint="先记下大米、调料和饮料，不够时会提醒补货" />
      ) : null}

      {groups.map(({ key, label, items: rows }) => (
        <div key={key} data-inventory-group={label}>
          <p className="sticky top-0 z-10 border-b border-border bg-surface/90 px-3.5 py-1.5 text-[12px] font-medium text-ink-soft backdrop-blur">
            {grouping === 'category' ? `${CATEGORY_EMOJI[label as InventoryCategory]} ${label}` : label}
          </p>
          <div>
            {rows.map((item) => (
              <InventoryRow
                key={item.id}
                item={item}
                queued={inShopping.has(item.name)}
                adjusting={upsert.isPending}
                restocking={restocking}
                locating={setLocation.isPending}
                emptyLocationLabel={grouping === 'location' ? '记一下放哪儿' : undefined}
                onEdit={() => setEditor(item)}
                onAdjust={(offset) => adjust(item, offset)}
                onRestock={() => void addRestock([item])}
                onLocate={(locationId) => setLocation.mutate({ target: 'item', id: item.id, locationId })}
              />
            ))}
          </div>
        </div>
      ))}
      </QueryFrame>
      </Panel>

      {/* 宽屏时把「会过期」和「动过什么」放右边一列，窄屏自动落回下面 */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-4 lg:w-[340px] lg:flex-none">
      <RestockPanel
        low={low}
        pending={needsShopping}
        busy={restocking}
        onRestock={(targets) => void addRestock(targets)}
      />

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
                <div key={batch.id} className="border-b border-border px-3 py-2.5 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setBatchEditor(batch)}
                    className="flex w-full items-center gap-3 rounded-lg text-left transition-colors duration-150 hover:bg-muted"
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
                  <LocationLine
                    locationId={batch.locationId}
                    name={`${batch.inventoryItem.name}这一批`}
                    pending={setLocation.isPending}
                    onChange={(locationId) => setLocation.mutate({ target: 'batch', id: batch.id, locationId })}
                  />
                </div>
              ))}
          </Card>
        </div>
      ) : null}

        <InventoryLog />
      </aside>


      {editor ? (
        <InventoryEditor
          key={editor === 'new' ? 'new' : editor.id}
          item={editor === 'new' ? null : editor}
          preset={editor === 'new' ? preset : null}
          onClose={() => {
            setEditor(null);
            setPreset(null);
          }}
          onRequestDelete={(item) => {
            setEditor(null);
            setDeleting(item);
          }}
        />
      ) : null}

      <LocateItemFlow
        items={list}
        onCreate={(next) => {
          setPreset(next);
          setEditor('new');
        }}
      />

      {batchEditor ? (
        <BatchDialog
          key={batchEditor === 'new' ? 'new' : batchEditor.id}
          batch={batchEditor === 'new' ? null : batchEditor}
          inventory={list}
          batches={activeBatches}
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
                      pushToast(`已删除「${deleting.name}」`, undefined, 'success');
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
    </Page>
  );
}
