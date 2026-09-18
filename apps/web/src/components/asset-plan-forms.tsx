import { useState } from 'react';
import type { MaintenanceConsumable, MaintenancePlan } from '@family/contracts';
import {
  shiftDays,
  todayISO,
  useCreateMaintenancePlan,
  useInventory,
  useUpsertMaintenanceConsumable,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';

export function PlanForm({
  assetId,
  assetName,
  onClose,
}: {
  assetId: string;
  assetName: string;
  onClose: () => void;
}) {
  const create = useCreateMaintenancePlan();
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState('180');
  const [nextDueDate, setNextDueDate] = useState(shiftDays(todayISO(), 30));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    const days = Number.parseInt(frequency, 10);
    if (!title.trim()) return setMessage('先写清楚要做的是什么');
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return setMessage('周期天数填 1 到 3650 之间的整数');
    }
    setMessage(null);
    create.mutate(
      { assetId, title: title.trim(), frequencyDays: days, nextDueDate, note: note.trim() || null },
      {
        onSuccess: () => {
          pushToast(`「${title.trim()}」已排进维护计划`);
          onClose();
        },
        // 同一件资产下重名会 409，后端的话比我们兜底的更准
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title="新增维护计划"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={create.isPending} onClick={submit}>
            {create.isPending ? '保存中…' : '保存维护计划'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">{assetName}</p>
        <label className="block">
          <span className={label}>要做什么</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="维护事项"
            placeholder="比如：清洗滤网"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>每隔多少天</span>
            <Input
              inputMode="numeric"
              value={frequency}
              aria-label="周期天数"
              placeholder="180"
              onChange={(event) => setFrequency(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>第一次到期</span>
            <Input
              type="date"
              value={nextDueDate}
              aria-label="首次到期日"
              onChange={(event) => setNextDueDate(event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className={label}>说明（选填）</span>
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            placeholder="操作步骤、耗材型号等"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
      </div>
    </Dialog>
  );
}

/** 关联一个库存项当耗材：完成维护时可以按这里的用量直接扣库。 */
export function ConsumableForm({
  assetId,
  plan,
  editing,
  onClose,
}: {
  assetId: string;
  plan: MaintenancePlan;
  editing: MaintenanceConsumable | null;
  onClose: () => void;
}) {
  const inventory = useInventory();
  const save = useUpsertMaintenanceConsumable();
  const [inventoryItemId, setInventoryItemId] = useState(editing?.inventoryItemId ?? '');
  const [quantity, setQuantity] = useState(editing ? String(Number(editing.quantity)) : '1');
  const [message, setMessage] = useState<string | null>(null);

  // 已经关联过的库存项不再出现在候选里（后端也会 409），编辑时保留自己那一项
  const options = (inventory.data ?? []).filter(
    (item) =>
      item.id === editing?.inventoryItemId ||
      !plan.consumables.some((one) => one.inventoryItemId === item.id),
  );
  const selected = options.find((item) => item.id === inventoryItemId);

  function submit() {
    const amount = Number(quantity);
    if (!inventoryItemId) return setMessage('先选一个库存项');
    if (!Number.isFinite(amount) || amount < 0.01) return setMessage('用量填个大于 0 的数字');
    setMessage(null);
    save.mutate(
      { assetId, planId: plan.id, consumableId: editing?.id, inventoryItemId, quantity: amount },
      {
        onSuccess: () => {
          pushToast(editing ? '耗材已更新' : '耗材已关联');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? '编辑维护耗材' : '关联维护耗材'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : editing ? '保存耗材' : '确认关联'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">{plan.title}</p>
        <div>
          <span className={label}>用哪个库存项</span>
          {options.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-ink-soft">
              没有可关联的库存项了。
            </p>
          ) : (
            <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
              {options.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={inventoryItemId === item.id}
                  onClick={() => setInventoryItemId(item.id)}
                  className={
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ' +
                    (inventoryItemId === item.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-border hover:bg-muted')
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{item.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-soft">
                    现有 {Number(item.quantity)} {item.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="block">
          <span className={label}>每次用量{selected ? `（${selected.unit}）` : ''}</span>
          <Input
            inputMode="decimal"
            value={quantity}
            aria-label="每次用量"
            placeholder="1"
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
