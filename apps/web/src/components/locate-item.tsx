import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { InventoryItem, StorageLocation } from '@family/contracts';
import { useSetLocation } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { CATEGORY_EMOJI } from './inventory-editor';
import { LocationPicker } from './location-picker';
import { Button, Dialog, Input } from './ui';

/**
 * ⌘K「记一下东西放哪」（`/house/inventory?locate=1`）：先开选择器挑位置，再挑是哪样东西——
 * 库存里已有的就一跳改它的默认位置；没有就带着名字和位置去新建。参数读完就抹掉（ia-plan 深链约定）。
 */
export function LocateItemFlow({
  items,
  onCreate,
}: {
  items: InventoryItem[];
  onCreate: (preset: { name: string; locationId: string }) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState<'idle' | 'where' | 'what'>('idle');
  const [where, setWhere] = useState<StorageLocation | null>(null);
  const [query, setQuery] = useState('');
  const setLocation = useSetLocation();
  const requested = params.get('locate') === '1';
  if (requested && step === 'idle') setStep('where');
  useEffect(() => {
    if (!requested) return;
    const next = new URLSearchParams(params);
    next.delete('locate');
    setParams(next, { replace: true });
  }, [params, requested, setParams]);

  const close = () => {
    setStep('idle');
    setWhere(null);
    setQuery('');
  };
  const needle = query.trim();
  const matches = items.filter((item) => item.name.includes(needle)).slice(0, 12);

  if (step === 'where') {
    return (
      <LocationPicker
        value={null}
        title="东西放在哪儿？"
        onClose={close}
        onPick={(location) => {
          if (!location) return close();
          setWhere(location);
          setStep('what');
        }}
      />
    );
  }
  if (step !== 'what' || !where) return null;
  return (
    <Dialog
      title={`放在「${where.pathLabel}」的是哪样东西？`}
      onClose={close}
      maxWidth={420}
      footer={
        needle && !items.some((item) => item.name === needle) ? (
          <Button className="w-full" onClick={() => { onCreate({ name: needle, locationId: where.id }); close(); }}>
            新建「{needle}」
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <Input autoFocus aria-label="东西的名字" value={query} placeholder="搜库存里的东西，或输入新名字" onChange={(event) => setQuery(event.target.value)} />
        {matches.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={setLocation.isPending}
            onClick={() =>
              setLocation.mutate(
                { target: 'item', id: item.id, locationId: where.id },
                { onSuccess: () => { pushToast(`记下了：${item.name}上次放在 ${where.pathLabel}`, undefined, 'success'); close(); }, onError: (error) => pushToast(error.message, undefined, 'error') },
              )
            }
            className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left text-[14px] transition-colors duration-150 hover:bg-muted disabled:opacity-50"
          >
            <span aria-hidden="true">{CATEGORY_EMOJI[item.category]}</span>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="shrink-0 text-[12px] text-ink-soft">{Number(item.quantity)} {item.unit}</span>
          </button>
        ))}
        {!matches.length ? <p className="text-[13px] text-ink-soft">库存里没有这样东西，可以在下面新建</p> : null}
      </div>
    </Dialog>
  );
}
