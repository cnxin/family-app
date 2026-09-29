import { useState } from 'react';
import type { ItemLocationHit } from '@family/contracts';
import { Input } from '../ui';

// 地图上方的找东西：输物品名，命中的柜子在图上高亮；下面列出「上次放在 …」，点一条对准过去。

const TYPE_LABEL: Record<ItemLocationHit['type'], string> = { item: '平时放', batch: '一批', asset: '资产' };

export function MapSearch({
  query,
  onQuery,
  hits,
  loading,
  onPick,
}: {
  query: string;
  onQuery: (value: string) => void;
  hits: ItemLocationHit[];
  loading: boolean;
  onPick: (hit: ItemLocationHit) => void;
}) {
  const [open, setOpen] = useState(true);
  const searching = query.trim().length > 0;
  return (
    <div className="relative z-10 mb-3 shrink-0">
      <div className="relative">
        <Input
          type="search"
          aria-label="找东西"
          placeholder="找东西：电池、护照、冬被…"
          value={query}
          maxLength={40}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && hits[0]) {
              onPick(hits[0]);
              setOpen(false);
            }
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        {loading ? <span aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-soft">…</span> : null}
      </div>
      {searching && open ? (
        <div
          data-map-hits
          className="absolute inset-x-0 top-full mt-1.5 max-h-[45vh] overflow-y-auto rounded-card border border-border bg-surface/95 p-1 shadow-lg backdrop-blur-xl motion-safe:animate-[page-in_160ms_cubic-bezier(0,0,0.2,1)]"
        >
          {hits.length ? (
            <ul>
              {hits.map((hit) => (
                <li key={`${hit.type}-${hit.id}-${hit.locationId}`}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full flex-col items-start justify-center rounded-lg px-3 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
                    onClick={() => {
                      onPick(hit);
                      setOpen(false);
                    }}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="truncate text-[14.5px] font-medium">{hit.name}</span>
                      <span className="shrink-0 text-[11.5px] text-ink-soft">{TYPE_LABEL[hit.type]}{hit.detail ? ` · ${hit.detail}` : ''}</span>
                    </span>
                    <span className="truncate text-[12.5px] text-ink-soft">上次放在 {hit.pathLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : loading ? null : (
            <p className="px-3 py-3 text-[13px] text-ink-soft">没找到记了位置的「{query.trim()}」</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
