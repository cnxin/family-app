import { useState } from 'react';
import type { ShoppingItem } from '@family/contracts';
import { todayISO, useConfirmShoppingReceipt, useShoppingInventoryPreview } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, SectionTitle } from './ui';

function num(value: string | null | undefined) {
  return value == null ? 0 : Number(value);
}

function itemName(item: ShoppingItem) {
  return item.ingredient?.name ?? item.customName ?? '未知';
}

function validOptionalDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === trimmed;
}

/** 确认入库：先看预览（加到哪个库存项、加完是多少），再决定要不要记批次。 */
export function StockDialog({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackBatch, setTrackBatch] = useState(false);
  const [productionDate, setProductionDate] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [openedOn, setOpenedOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = useShoppingInventoryPreview(item.id, selectedId, true);
  const confirm = useConfirmShoppingReceipt();
  const data = preview.data;
  const selected = data?.selectedInventoryItem ?? null;
  const name = itemName(item);
  const datesValid = [productionDate, expiresOn, openedOn].every(validOptionalDate);
  const canSubmit = Boolean(data?.canConfirm && selected && datesValid) && !confirm.isPending;

  const submit = () => {
    if (!canSubmit || !selected) return;
    setError(null);
    confirm.mutate(
      {
        shoppingItemId: item.id,
        inventoryItemId: selected.id,
        batch: trackBatch
          ? {
              receivedOn: todayISO(),
              productionDate: productionDate.trim() || null,
              expiresOn: expiresOn.trim() || null,
              openedOn: openedOn.trim() || null,
            }
          : undefined,
      },
      {
        onSuccess: (result) => {
          const transaction = result.transactions[0];
          pushToast(
            result.alreadyConfirmed
              ? `「${name}」已经入过库，没有重复增加`
              : `已入库 ${num(transaction?.delta)} ${transaction?.unit ?? ''}，当前 ${num(transaction?.quantityAfter)} ${transaction?.unit ?? ''}${trackBatch ? '，并记了批次' : ''}`,
          );
          onClose();
        },
        onError: (mutationError) =>
          setError(mutationError instanceof Error ? mutationError.message : '入库失败'),
      },
    );
  };

  return (
    <Dialog
      title={`确认「${name}」入库`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={confirm.isPending} onClick={onClose}>
            暂不入库
          </Button>
          <Button className="flex-1" disabled={!canSubmit} onClick={submit}>
            {confirm.isPending ? '入库中…' : '确认入库'}
          </Button>
        </div>
      }
    >
      <p className="text-[13px] text-ink-soft">
        采购数量 {num(item.totalQty)} {item.unit ?? ''}
      </p>

      {preview.isPending ? <p className="mt-4 text-sm text-ink-soft">读取中…</p> : null}

      {data ? (
        <>
          <SectionTitle>加到哪个库存项</SectionTitle>
          {data.candidates.length ? (
            <div className="flex flex-col gap-2">
              {data.candidates.map((candidate) => {
                const active = selected?.id === candidate.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(candidate.id)}
                    className={
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors duration-150 ' +
                      (active
                        ? 'border-accent bg-accent-soft'
                        : 'border-border bg-surface hover:bg-muted')
                    }
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{candidate.name}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-soft">
                        当前 {num(candidate.quantity)} {candidate.unit}
                      </span>
                    </span>
                    {active ? <span className="text-accent">✓</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg bg-warm-soft px-3 py-2 text-[13px] text-warm">
              没有同单位的库存项，这一项暂时入不了库。可以先去「家庭库存」建一个。
            </p>
          )}

          {selected && data.quantityBefore != null && data.quantityAfter != null ? (
            <div className="mt-3 rounded-lg bg-accent-soft px-3 py-2.5">
              <p className="text-[12px] font-medium text-accent">预计变化</p>
              <p className="mt-1 text-sm font-medium">
                {selected.name}：{data.quantityBefore} → {data.quantityAfter} {selected.unit}
              </p>
            </div>
          ) : null}

          {selected ? (
            <>
              <button
                type="button"
                role="checkbox"
                aria-checked={trackBatch}
                onClick={() => setTrackBatch((value) => !value)}
                className={
                  'mt-3 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ' +
                  (trackBatch ? 'border-accent bg-accent-soft' : 'border-border hover:bg-muted')
                }
              >
                <span className={trackBatch ? 'text-accent' : 'text-ink-soft'}>
                  {trackBatch ? '☑' : '☐'}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">记录采购批次</span>
                  <span className="mt-0.5 block text-[12px] text-ink-soft">
                    用于临期提醒和先进先出扣库
                  </span>
                </span>
              </button>

              {trackBatch ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  {(
                    [
                      ['生产日期（选填）', productionDate, setProductionDate],
                      ['到期日期（选填）', expiresOn, setExpiresOn],
                      ['开封日期（选填）', openedOn, setOpenedOn],
                    ] as const
                  ).map(([label, value, setter]) => (
                    <label key={label} className="block">
                      <span className="mb-1 block text-[12px] text-ink-soft">{label}</span>
                      <Input
                        type="date"
                        value={value}
                        onChange={(event) => setter(event.target.value)}
                      />
                    </label>
                  ))}
                  {datesValid ? null : (
                    <p className="text-[12px] text-danger">请使用有效的 YYYY-MM-DD 日期</p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </Dialog>
  );
}
