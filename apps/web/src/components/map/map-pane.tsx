import { useEffect, useMemo, useRef, useState } from 'react';
import type { HouseholdMap, MapShape, StorageLocation } from '@family/contracts';
import { shapeBounds, shapePoints } from '@family/shared';
import { useCreateLocation, useFindItemLocations, useMapBackground, useUpdateLocation } from '../../lib/queries';
import { pushToast } from '../../lib/toast';
import { DetentSheet } from '../ui/detent-sheet';
import { Button } from '../ui';
import { MapCanvas, type MapCanvasHandle } from './map-canvas';
import { MapDrawer } from './map-drawer';
import { MapEditBar } from './map-edit-bar';
import { MapNameDialog } from './map-name-dialog';
import { MapSearch } from './map-search';
import type { MapItem, MapMode, MapTool } from './map-types';
import { useShapeSaver } from './use-shape-saver';

// 地图这一栏（item-location-plan §3 I2b）：搜索 → 画布 → 点了什么就出抽屉；管理员的编辑工具条也在这里。

function itemOf(location: StorageLocation): MapItem | null {
  if (!location.mapShape || location.archivedAt || location.kind === 'slot') return null;
  return { id: location.id, parentId: location.parentId, kind: location.kind, name: location.name, shape: location.mapShape };
}

const toPolygon = (shape: MapShape): MapShape => (shape.type === 'polygon' ? shape : { type: 'polygon', points: shapePoints(shape) });

export function MapPane({
  map,
  locations,
  mode,
  desktop,
  selectedId,
  onSelect,
  initialQuery = '',
  focusRequest,
}: {
  map: HouseholdMap;
  locations: StorageLocation[];
  mode: MapMode;
  desktop: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  initialQuery?: string;
  /** 从 ⌘K / 详情跳过来：要对准的位置（变了就再对一次） */
  focusRequest?: { id: string; seq: number } | null;
}) {
  const canvas = useRef<MapCanvasHandle>(null);
  const background = useMapBackground(map);
  const saver = useShapeSaver();
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const [tool, setTool] = useState<MapTool>('select');
  const [showBackground, setShowBackground] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [drawn, setDrawn] = useState<{ kind: 'room' | 'container'; shape: MapShape; parentId: string | null } | null>(null);
  const hits = useFindItemLocations(debounced);
  const editing = mode !== 'view';

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const byId = useMemo(() => new Map(locations.map((one) => [one.id, one])), [locations]);
  const items = useMemo(() => locations.map(itemOf).filter((one): one is MapItem => one !== null), [locations]);
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
  const focusOn = (id: string, drawerOpen = !editing) => {
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
    if (id && !editing) {
      navigator.vibrate?.(8);
      focusOn(id);
    }
  };

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const onDraw = (kind: 'room' | 'container', rect: MapShape, parentId: string | null) => {
    setDrawn({ kind, parentId, shape: kind === 'room' ? toPolygon(rect) : rect });
  };
  const siblings = drawn ? locations.filter((one) => one.parentId === drawn.parentId && !one.archivedAt && !one.systemKey) : [];

  const place = async (location: StorageLocation) => {
    if (!drawn) return;
    const shape = drawn.shape;
    setDrawn(null);
    setTool('select');
    await saver.saveNow([{ id: location.id, shape }]);
    onSelect(location.id);
    navigator.vibrate?.(10);
  };

  const drawer = selected && !editing ? (
    <MapDrawer location={selected} locations={locations} hitIds={hitIds} hitNames={hitNames} onPick={(id) => { select(id); focusOn(id); }} />
  ) : null;
  const drawerTitle = selected ? (selected.kind === 'room' ? selected.name : selected.pathLabel) : '';

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {!editing ? (
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
      ) : (
        <MapEditBar
          mode={mode}
          tool={tool}
          onTool={setTool}
          selected={selected}
          showBackground={showBackground}
          onToggleBackground={map.hasBackground ? () => setShowBackground(!showBackground) : undefined}
          onRename={(name) =>
            selected && update.mutate({ id: selected.id, name }, { onError: (error) => pushToast(error.message) })
          }
          onRotate={() => {
            const shape = selected?.mapShape;
            if (!selected || shape?.type !== 'rect') return;
            const cx = shape.x + shape.w / 2;
            const cy = shape.y + shape.h / 2;
            const turned = { type: 'rect' as const, x: Math.round(cx - shape.h / 2), y: Math.round(cy - shape.w / 2), w: shape.h, h: shape.w };
            const parent = selected.parentId ? byId.get(selected.parentId)?.mapShape : null;
            const b = parent ? shapeBounds(parent) : null;
            if (b && (turned.x < b.minX || turned.y < b.minY || turned.x + turned.w > b.maxX || turned.y + turned.h > b.maxY)) {
              pushToast('转过来会出房间，先往中间挪一挪');
              return;
            }
            saver.save([{ id: selected.id, shape: turned }]);
          }}
          onRemove={() => {
            if (!selected) return;
            const kids = locations.filter((one) => one.parentId === selected.id && one.mapShape);
            saver.save([...kids.map((one) => ({ id: one.id, shape: null })), { id: selected.id, shape: null }]);
            onSelect(null);
          }}
        />
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-muted">
        <MapCanvas
          ref={canvas}
          label="家庭地图"
          viewBox={map.viewBox}
          items={items}
          background={editing || !hasRooms ? (showBackground ? background : null) : null}
          backgroundOpacity={editing && hasRooms ? 0.45 : 1}
          mode={mode}
          tool={tool}
          selectedId={selectedId}
          highlightIds={highlightIds}
          onSelect={select}
          onShapesChange={saver.save}
          onDraw={onDraw}
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
        {!hasRooms && !editing ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-surface/90 px-3 py-1.5 text-[12.5px] text-ink-soft backdrop-blur">
            房间还没画上去{mode === 'view' ? '，管理员在「编辑」里画' : ''}
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
      {drawn ? (
        <MapNameDialog
          kind={drawn.kind}
          unplaced={siblings.filter((one) => !one.mapShape && (drawn.kind === 'room' ? one.kind === 'room' : one.kind !== 'slot'))}
          taken={siblings.map((one) => one.name)}
          busy={create.isPending}
          onClose={() => setDrawn(null)}
          onPickExisting={(location) => void place(location)}
          onCreate={(name) =>
            create.mutate(
              { parentId: drawn.parentId, name, kind: drawn.kind === 'room' ? undefined : 'container' },
              { onSuccess: (location) => void place(location), onError: (error) => pushToast(error.message) },
            )
          }
        />
      ) : null}
    </div>
  );
}
