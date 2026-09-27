import { useState } from 'react';
import type { InventoryBatch, InventoryCategory, InventoryItem } from '@family/contracts';
import { INVENTORY_CATEGORIES } from '@family/contracts';
import {
  todayISO,
  useCreateInventoryBatch,
  useUpdateInventoryBatch,
  useUpsertInventoryItem,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, selectClass } from './ui';

export const CATEGORY_EMOJI: Record<InventoryCategory, string> = {
  调料: '🧂',
  主食: '🍚',
  饮料: '🥛',
  零食: '🍪',
  日用品: '🧻',
  药品: '💊',
  其他: '📦',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-ink-soft">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-soft">{hint}</span> : null}
    </label>
  );
}

/** 新建 / 编辑一个库存项。改余量会记一条 adjustment 流水，所以这里也算一次「动库存」。 */
export function InventoryEditor({
  item,
  onClose,
  onRequestDelete,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onRequestDelete: (item: InventoryItem) => void;
}) {
  const upsert = useUpsertInventoryItem();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<InventoryCategory>(item?.category ?? '其他');
  const [quantity, setQuantity] = useState(String(Number(item?.quantity ?? 0)));
  const [unit, setUnit] = useState(item?.unit ?? '份');
  const [threshold, setThreshold] = useState(String(Number(item?.lowStockThreshold ?? 1)));
  const [restock, setRestock] = useState(String(Number(item?.restockQuantity ?? 1)));

  const numbers = [quantity, threshold, restock].map(Number);
  const valid =
    Boolean(name.trim()) &&
    Boolean(unit.trim()) &&
    numbers.every((value) => Number.isFinite(value) && value >= 0) &&
    Number(restock) > 0;

  const submit = () => {
    if (!valid || upsert.isPending) return;
    upsert.mutate(
      {
        id: item?.id,
        name: name.trim(),
        category,
        quantity: Number(quantity),
        unit: unit.trim(),
        lowStockThreshold: Number(threshold),
        restockQuantity: Number(restock),
      },
      {
        onSuccess: () => {
          pushToast(item ? `已更新「${name.trim()}」` : `已添加「${name.trim()}」`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      title={item ? `编辑「${item.name}」` : '新增库存'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {item ? (
            <Button
              variant="ghost"
              className="px-3 text-danger"
              onClick={() => onRequestDelete(item)}
            >
              删除
            </Button>
          ) : null}
          <Button className="ml-auto min-w-24" disabled={!valid || upsert.isPending} onClick={submit}>
            {upsert.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="名称">
          <Input
            autoFocus
            value={name}
            placeholder="比如：大米、酱油、牛奶"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="分类">
          <div className="flex flex-wrap gap-1.5">
            {INVENTORY_CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === category}
                onClick={() => setCategory(value)}
                className={
                  'rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors duration-150 ' +
                  (value === category
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-surface text-ink-soft hover:bg-muted')
                }
              >
                {CATEGORY_EMOJI[value]} {value}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="当前余量">
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          <Field label="单位">
            <Input
              value={unit}
              placeholder="袋、瓶、斤"
              onChange={(event) => setUnit(event.target.value)}
            />
          </Field>
          <Field label="低于多少提醒">
            <Input
              inputMode="decimal"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </Field>
          <Field label="每次补多少" hint="加进购物清单时用这个数量">
            <Input
              inputMode="decimal"
              value={restock}
              onChange={(event) => setRestock(event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** 登记 / 修改一个批次。批次是保质期提醒和先进先出扣库的依据。 */
export function BatchDialog({
  batch,
  inventory,
  onClose,
}: {
  batch: InventoryBatch | null;
  inventory: InventoryItem[];
  onClose: () => void;
}) {
  const create = useCreateInventoryBatch();
  const update = useUpdateInventoryBatch();
  const [inventoryItemId, setInventoryItemId] = useState(
    batch?.inventoryItemId ?? inventory[0]?.id ?? '',
  );
  const [quantity, setQuantity] = useState(String(Number(batch?.quantity ?? 1)));
  const [receivedOn, setReceivedOn] = useState(batch?.receivedOn ?? todayISO());
  const [productionDate, setProductionDate] = useState(batch?.productionDate ?? '');
  const [expiresOn, setExpiresOn] = useState(batch?.expiresOn ?? '');
  const [openedOn, setOpenedOn] = useState(batch?.openedOn ?? '');

  const pending = create.isPending || update.isPending;
  const valid = Boolean(inventoryItemId) && Number(quantity) > 0 && Boolean(receivedOn);
  const dates = {
    receivedOn,
    productionDate: productionDate || null,
    expiresOn: expiresOn || null,
    openedOn: openedOn || null,
  };

  const submit = () => {
    if (!valid || pending) return;
    const done = { onSuccess: () => { pushToast(batch ? '批次已更新' : '批次已登记'); onClose(); } };
    if (batch) {
      update.mutate({ id: batch.id, expectedVersion: batch.version, ...dates }, done);
    } else {
      create.mutate({ inventoryItemId, quantity: Number(quantity), ...dates }, done);
    }
  };

  return (
    <Dialog
      title={batch ? `修改「${batch.inventoryItem.name}」批次` : '登记食品批次'}
      onClose={onClose}
      footer={
        <Button className="w-full" disabled={!valid || pending} onClick={submit}>
          {pending ? '保存中…' : batch ? '保存修改' : '登记并入库'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {batch ? null : (
          <>
            <Field label="库存项">
              <select
                aria-label="选择库存项"
                value={inventoryItemId}
                onChange={(event) => setInventoryItemId(event.target.value)}
                className={`${selectClass} h-10 w-full`}
              >
                {inventory.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}（现有 {Number(option.quantity)} {option.unit}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="这一批的数量" hint="登记后会同时增加库存余量">
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
          </>
        )}

        <Field label="到货日期">
          <Input
            type="date"
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="生产日期（选填）">
            <Input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
            />
          </Field>
          <Field label="到期日期（选填）">
            <Input
              type="date"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
          </Field>
        </div>
        <Field label="开封日期（选填）" hint="开封后通常保质期会缩短">
          <Input
            type="date"
            value={openedOn}
            onChange={(event) => setOpenedOn(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
