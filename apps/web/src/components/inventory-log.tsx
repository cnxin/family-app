import { useState } from 'react';
import type { InventoryTransaction } from '@family/contracts';
import { useInventoryTransactions, useReverseInventoryTransaction } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Card, Dialog, SectionTitle } from './ui';

const TYPE_LABEL: Record<InventoryTransaction['type'], string> = {
  receipt: '入库',
  consumption: '扣库',
  adjustment: '调整',
  reversal: '撤销',
};

function when(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * 库存流水是不可变的：撤销不是删除，而是追加一条反向流水。
 * 一餐的扣库会整组撤销，所以确认框里要把同一次操作的每一项都列出来。
 */
export function InventoryLog() {
  const { data: transactions } = useInventoryTransactions();
  const reverse = useReverseInventoryTransaction();
  const [pending, setPending] = useState<InventoryTransaction | null>(null);

  const rows = transactions ?? [];
  if (!rows.length) return null;

  const group = pending
    ? rows.filter(
        (row) => row.operationId === pending.operationId && row.type === pending.type,
      )
    : [];

  return (
    <div className="mt-5">
      <SectionTitle>库存流水</SectionTitle>
      <Card>
        {rows.slice(0, 30).map((row) => {
          const positive = Number(row.delta) > 0;
          return (
            <div
              key={row.id}
              className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
            >
              <span
                className={
                  'grid size-7 shrink-0 place-items-center rounded-full text-[13px] ' +
                  (positive ? 'bg-accent-soft text-accent' : 'bg-warm-soft text-warm')
                }
              >
                {row.type === 'reversal' ? '↺' : positive ? '+' : '−'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {row.inventoryItem.name} · {TYPE_LABEL[row.type]}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  {Number(row.quantityBefore)} → {Number(row.quantityAfter)} {row.unit} ·{' '}
                  {row.actorName} · {when(row.createdAt)}
                </p>
                {row.reversedAt ? (
                  <p className="mt-0.5 text-[12px] text-ink-soft">已撤销</p>
                ) : null}
              </div>
              {row.canReverse ? (
                <Button
                  variant="outline"
                  className="h-8 shrink-0 px-2.5 text-[12px] text-accent"
                  onClick={() => setPending(row)}
                >
                  撤销
                </Button>
              ) : null}
            </div>
          );
        })}
      </Card>

      {pending ? (
        <Dialog
          title={`撤销这次${TYPE_LABEL[pending.type]}`}
          onClose={() => setPending(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPending(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={reverse.isPending}
                onClick={() =>
                  reverse.mutate(pending.id, {
                    onSuccess: () => {
                      pushToast('已追加反向流水，库存恢复');
                      setPending(null);
                    },
                  })
                }
              >
                {reverse.isPending ? '撤销中…' : '确认撤销'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {pending.sourceType === 'menu'
              ? '同一餐的关联库存会整组恢复，并追加反向流水；历史流水不会删除。'
              : '将追加反向流水恢复这次库存变化；历史流水不会删除。'}
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {(group.length ? group : [pending]).map((row) => (
              <p key={row.id} className="text-sm">
                {row.inventoryItem.name}：{Number(row.quantityAfter)} → {Number(row.quantityBefore)}{' '}
                {row.unit}
              </p>
            ))}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
