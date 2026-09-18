import { useState } from 'react';
import type { MaintenancePlan } from '@family/contracts';
import {
  assetDateLabel,
  shiftDays,
  todayISO,
  useAddMaintenanceShoppingItems,
  useCompleteMaintenance,
  useMaintenanceConsumablesPreview,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, Segmented } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';

const ROW_TAIL = {
  ready: { text: '够扣', className: 'text-accent' },
  insufficient: { text: '不够', className: 'text-danger' },
  unit_mismatch: { text: '单位变了', className: 'text-warm' },
} as const;

export function CompletionForm({
  assetId,
  plan,
  onClose,
}: {
  assetId: string;
  plan: MaintenancePlan;
  onClose: () => void;
}) {
  const preview = useMaintenanceConsumablesPreview(plan.id);
  const complete = useCompleteMaintenance();
  const addShopping = useAddMaintenanceShoppingItems();

  const [performedOn, setPerformedOn] = useState(todayISO());
  const [shoppingDate, setShoppingDate] = useState(todayISO());
  const [mode, setMode] = useState<'skip' | 'consume'>('skip');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // 一次挂载一个键：失败了重试要用同一个，否则重试会记成两次维护、日期推两遍
  const [idempotencyKey] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const rows = preview.data?.rows ?? [];
  const canConsume = preview.data?.canConsume ?? false;
  const price = cost.trim() ? Number(cost) : null;

  function pickMode(next: 'skip' | 'consume') {
    if (next === 'consume' && !canConsume) {
      return setMessage('库存不够或者单位变了，这次先别扣库');
    }
    setMessage(null);
    setMode(next);
  }

  function submit() {
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return setMessage('费用填个数字');
    }
    setMessage(null);
    complete.mutate(
      {
        assetId,
        planId: plan.id,
        // 锚在当天中午再转 UTC：直接用 00:00 会在东八区变成前一天
        performedAt: new Date(`${performedOn}T12:00:00`).toISOString(),
        cost: price,
        note: note.trim() || null,
        consumeInventory: mode === 'consume',
        idempotencyKey,
      },
      {
        onSuccess: (result) => {
          pushToast(
            result.alreadyCompleted
              ? '这次维护已经记过了，日期没有重复往后推'
              : `维护记下了，下次安排在 ${assetDateLabel(result.plan.nextDueDate)}`,
          );
          onClose();
        },
        // 故意不关弹窗：留在这儿用同一个幂等键重试
        onError: (error) => setMessage(error instanceof Error ? error.message : '没记录成功'),
      },
    );
  }

  return (
    <Dialog
      title="确认完成维护"
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button
            className="w-full"
            disabled={complete.isPending || preview.isPending}
            onClick={submit}
          >
            {complete.isPending
              ? '记录中…'
              : mode === 'consume'
                ? '确认完成、扣库并推进日期'
                : '确认完成并推进日期'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">{plan.title}</p>

        <label className="block">
          <span className={label}>实际完成日期</span>
          <Input
            type="date"
            value={performedOn}
            aria-label="实际完成日期"
            onChange={(event) => setPerformedOn(event.target.value)}
          />
        </label>

        <div className="rounded-lg bg-accent-soft px-3 py-2.5">
          <p className="text-[12px] text-accent">下次安排</p>
          <p className="mt-0.5 text-[14px] font-medium text-accent">
            {assetDateLabel(shiftDays(performedOn, plan.frequencyDays))}
          </p>
          <p className="mt-0.5 text-[12px] text-accent/80">
            按 {plan.frequencyDays} 天周期从完成日重新算
          </p>
        </div>

        <div>
          <span className={label}>耗材</span>
          {preview.isPending ? (
            <p className="text-[13px] text-ink-soft">正在看库存…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-ink-soft">
              这条计划没关联耗材，完成时不涉及库存。
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {rows.map((row) => {
                  const tail = ROW_TAIL[row.status];
                  return (
                    <article
                      key={row.consumableId}
                      aria-label={row.inventoryItemName}
                      className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">
                          {row.inventoryItemName} · 用 {row.quantity} {row.unit}
                        </p>
                        <p className="text-[12px] text-ink-soft">
                          {row.status === 'unit_mismatch'
                            ? `关联时是 ${row.unit}，库存单位已经变成 ${row.currentUnit}`
                            : `库存 ${row.quantityBefore} → ${row.quantityAfter} ${row.unit}`}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[12px] ${tail.className}`}>
                        {tail.text}
                        {row.status === 'insufficient' ? ` ${row.shortage} ${row.unit}` : ''}
                      </span>
                    </article>
                  );
                })}
              </div>
              <div className="mt-2">
                <Segmented
                  value={mode}
                  onChange={pickMode}
                  options={[
                    { value: 'skip' as const, label: '只记完成' },
                    { value: 'consume' as const, label: '顺便扣库存' },
                  ]}
                />
              </div>
            </>
          )}
        </div>

        {preview.data?.hasShortage ? (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <span className={label}>缺的耗材加进哪天的购物清单</span>
            <div className="flex gap-2">
              <Input
                type="date"
                value={shoppingDate}
                aria-label="购物清单日期"
                onChange={(event) => setShoppingDate(event.target.value)}
              />
              <Button
                variant="outline"
                className="shrink-0"
                disabled={addShopping.isPending}
                onClick={() =>
                  addShopping.mutate(
                    { assetId, planId: plan.id, date: shoppingDate },
                    {
                      onSuccess: (result) =>
                        pushToast(
                          result.items.length
                            ? `购物清单：新增 ${result.createdCount} 项，已有 ${result.existingCount} 项`
                            : '现有库存其实够用，没往清单里加',
                        ),
                      onError: (error) =>
                        setMessage(error instanceof Error ? error.message : '没加进购物清单'),
                    },
                  )
                }
              >
                {addShopping.isPending ? '加入中…' : '加入清单'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>本次费用（选填）</span>
            <Input
              inputMode="decimal"
              value={cost}
              aria-label="本次费用"
              placeholder="0"
              onChange={(event) => setCost(event.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className={label}>这次做了什么（选填）</span>
          <textarea
            value={note}
            rows={2}
            maxLength={1000}
            placeholder="换了什么、发现了什么问题"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
      </div>
    </Dialog>
  );
}
