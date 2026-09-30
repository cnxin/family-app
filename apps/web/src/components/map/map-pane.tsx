import { useEffect, useMemo, useRef, useState } from 'react';
import type { HouseholdMap, StorageLocation } from '@family/contracts';
import { shapeBounds } from '@family/shared';
import { useFindItemLocations, useMapBackground } from '../../lib/queries';
import { pushToast } from '../../lib/toast';
import { DetentSheet } from '../ui/detent-sheet';
import { Button } from '../ui';
import { MapCanvas, type MapCanvasHandle } from './map-canvas';
import { MapDrawer } from './map-drawer';
import { MapSearch } from './map-search';
import { mapItems } from './map-items';

// 地图这一栏的看模式（item-location-plan §3 I2b）：搜索 → 画布 → 点了什么就出抽屉。
// 编辑是另一个全屏组件（editor/map-editor.tsx，地图编辑器 v2）。

export function MapPane({
  map,
  locations,
  desktop,
  selectedId,
  onSelect,
  initialQuery = '',
  focusRequest,
}: {
  map: HouseholdMap;
  locations: StorageLocation[];
  desktop: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  initialQuery?: string;
  /** 从 ⌘K / 详情跳过来：要对准的位置（变了就再对一次） */
  focusRequest?: { id: string; seq: number } | null;
}) {
  const canvas = useRef<MapCanvasHandle>(null);
  const background = useMapBackground(map);
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const hits = useFindItemLocations(debounced);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const byId = useMemo(() => new Map(locations.map((one) => [one.id, one])), [locations]);
  // 装饰类家具只画不可点（点穿到房间上）
  const items = useMemo(() => mapItems(locations, map.decorations), [locations, map.decorations]);
  const hasRooms = items.some((one) => one.kind === 'room');

  /** 往上找第一个画在图上的（层格 → 柜子 → 房间） */
  const placed = (id: string | null | undefined) => {
    let current = id ? byId.get(id) : undefined;
    while (current && !current.mapShape) current = current.parentId ? byId.get(current.parentId) : undefined;
    return current ?? null;
  };
  const hitList = useMemo(() => (debounced.trim() ? hits.data ?? [] : []), [debounced, hits.data]);
  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    for (const hit of hitList) {
      const shown = placed(hit.locationId);
      if (shown) ids.add(shown.id);
    }
    return ids;
    // placed 只读 byId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitList, byId]);
  const hitIds = useMemo(() => new Set(hitList.map((hit) => hit.locationId)), [hitList]);
  const hitNames = useMemo(() => new Set(hitList.map((hit) => hit.name)), [hitList]);

  /** 对准一个位置；抽屉会开着的时候（看模式）让开抽屉盖住的那块 */
  const focusOn = (id: string, drawerOpen = true) => {
    const shown = placed(id);
    if (!shown?.mapShape) return;
    const inset = !drawerOpen ? {} : desktop ? { right: 352 } : { bottom: window.innerHeight * 0.45 - 60 };
    canvas.current?.focus(shapeBounds(shown.mapShape), shown.kind === 'room' ? 2 : 3.5, inset);
  };

  useEffect(() => {
    if (!focusRequest) return;
    const target = byId.get(focusRequest.id);
    if (!target) return;
    const shown = target.kind === 'slot' ? placed(target.id) ?? target : target;
    onSelect(shown.id);
    // 画布量好尺寸后再对准
    const id = window.setTimeout(() => focusOn(shown.id), 60);
    return () => window.clearTimeout(id);
    // 只在请求变化时跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.seq, byId.size]);

  const select = (id: string | null) => {
    onSelect(id);
    if (id) {
      navigator.vibrate?.(8);
      focusOn(id);
    }
  };

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const drawer = selected ? (
    <MapDrawer location={selected} locations={locations} hitIds={hitIds} hitNames={hitNames} onPick={(id) => { select(id); focusOn(id); }} />
  ) : null;
  const drawerTitle = selected ? (selected.kind === 'room' ? selected.name : selected.pathLabel) : '';

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <MapSearch
          query={query}
          onQuery={setQuery}
          hits={hitList}
          loading={hits.isFetching}
          onPick={(hit) => {
            const shown = placed(hit.locationId);
            if (!shown) {
              pushToast(`「${hit.pathLabel}」还没画到地图上`);
              return;
            }
            select(shown.id);
            focusOn(shown.id);
          }}
        />
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-muted">
        <MapCanvas
          ref={canvas}
          label="家庭地图"
          viewBox={map.viewBox}
          items={items}
          background={hasRooms ? null : background}
          mode="view"
          selectedId={selectedId}
          highlightIds={highlightIds}
          onSelect={select}
          onHint={pushToast}
          overlay={
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              {desktop ? (
                <>
                  <Button variant="ghost" aria-label="放大" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.zoomBy(1.4)}>＋</Button>
                  <Button variant="ghost" aria-label="缩小" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.zoomBy(1 / 1.4)}>－</Button>
                </>
              ) : null}
              <Button variant="ghost" aria-label="看全图" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.reset()}>⤢</Button>
            </div>
          }
        />
        {!hasRooms ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-surface/90 px-3 py-1.5 text-[12.5px] text-ink-soft backdrop-blur">
            房间还没画上去，管理员在「编辑」里画
          </p>
        ) : null}
        {drawer && desktop ? (
          <aside
            aria-label={drawerTitle}
            className="absolute bottom-3 right-16 top-3 flex w-[320px] flex-col overflow-hidden rounded-card border border-border bg-surface/95 shadow-lg backdrop-blur-xl motion-safe:animate-[page-in_190ms_cubic-bezier(0,0,0.2,1)]"
          >
            <header className="flex items-start gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold">{drawerTitle}</h2>
                {selected?.itemCount ? <p className="text-[12px] text-ink-soft">直接放着 {selected.itemCount} 样</p> : null}
              </div>
              <button type="button" aria-label="关闭" className="-mr-2 grid size-11 place-items-center rounded-lg text-ink-soft hover:bg-muted" onClick={() => onSelect(null)}>✕</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{drawer}</div>
          </aside>
        ) : null}
      </div>
      {drawer && !desktop ? (
        <DetentSheet key={selected?.id} title={drawerTitle} modal={false} mediumShown={0.45} onClose={() => onSelect(null)}
          header={<h2 className="truncate text-[17px] font-semibold">{drawerTitle}</h2>}>
          {drawer}
        </DetentSheet>
      ) : null}
    </div>
  );
}
