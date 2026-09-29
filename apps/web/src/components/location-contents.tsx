import type { StorageLocation } from '@family/contracts';
import { useLocationContents } from '../lib/queries';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { SoftLink } from './soft-link';
import { EmptyState, Panel } from './ui';

const ASSET_EMOJI: Record<string, string> = {
  appliance: '🔌', furniture: '🛋️', electronics: '💻', tool: '🔧', subscription: '🔁', other: '📦',
};

/** 这个位置（含子位置）下记着的东西：库存物品、有余量的批次、资产。都是「上次放在」，不是清点结果。 */
export function LocationContents({ location }: { location: StorageLocation }) {
  const contents = useLocationContents(location.id);
  const data = contents.data;
  const empty = data && !data.items.length && !data.batches.length && !data.assets.length;
  return (
    <Panel title={location.pathLabel} grow={false}>
      <QueryFrame query={contents} skeleton={<div className="p-3"><ListSkeleton rows={3} /></div>}>
        <div data-location-contents={location.id} className="flex flex-col gap-3 p-3">
          {empty ? <EmptyState emoji="🗄️" title="这里还没记东西" hint="入库时选这个位置，或在库存里点「上次放在」改过来" /> : null}
          {data?.items.length ? (
            <section>
              <h3 className="mb-1 text-[12px] font-medium text-ink-soft">库存</h3>
              {data.items.map((item) => (
                <SoftLink key={item.id} to="/house/inventory" className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[14px] hover:bg-muted">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-soft">{Number(item.quantity)} {item.unit}</span>
                </SoftLink>
              ))}
            </section>
          ) : null}
          {data?.batches.length ? (
            <section>
              <h3 className="mb-1 text-[12px] font-medium text-ink-soft">食材批次</h3>
              {data.batches.map((batch) => (
                <div key={batch.id} className="flex items-center justify-between px-2 py-1.5 text-[14px]">
                  <span className="truncate">{batch.itemName}</span>
                  <span className="shrink-0 text-[12px] text-ink-soft">
                    {Number(batch.quantity)} {batch.unit}{batch.expiresOn ? ` · 到期 ${batch.expiresOn}` : ''}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          {data?.assets.length ? (
            <section>
              <h3 className="mb-1 text-[12px] font-medium text-ink-soft">资产</h3>
              {data.assets.map((asset) => (
                <SoftLink key={asset.id} to={`/house/assets/${asset.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] hover:bg-muted">
                  <span aria-hidden="true">{ASSET_EMOJI[asset.category] ?? '📦'}</span>
                  <span className="truncate">{asset.name}</span>
                </SoftLink>
              ))}
            </section>
          ) : null}
        </div>
      </QueryFrame>
    </Panel>
  );
}
