import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HouseholdMap, MapShape, StorageLocation } from '@family/contracts';
import { shapeBounds, shapePoints } from '@family/shared';
import { useCreateLocation, useMapBackground, useUpdateLocation } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import { Button, Dialog } from '../../ui';
import { MapCanvas, type MapCanvasHandle } from '../map-canvas';
import { MapNameDialog } from '../map-name-dialog';
import type { MapItem, MapMode, MapTool } from '../map-types';
import { useShapeSaver } from '../use-shape-saver';
import { EditorToolbar, type EditorTool } from './editor-toolbar';
import { FloatingToolbar, type ToolbarAction } from './floating-toolbar';
import { RoomDrawer } from './room-drawer';

// 全屏沉浸的地图编辑器（docs/ui-prototypes/map-editor-v2.md §1）：portal 盖在整个应用之上，
// 隐藏标题、左树、底部导航；只留一条工具栏、左上房间抽屉、右上「完成」。选中什么就在它旁边出浮动小工具条。
// 电脑上什么都能改；手机上房间形状不动，柜子 / 家具能拖、拉、转、改名、删（v2 拍板 1）。

function itemOf(location: StorageLocation): MapItem | null {
  if (!location.mapShape || location.archivedAt || location.kind === 'slot') return null;
  return { id: location.id, parentId: location.parentId, kind: location.kind, name: location.name, shape: location.mapShape };
}

const toPolygon = (shape: MapShape): MapShape => (shape.type === 'polygon' ? shape : { type: 'polygon', points: shapePoints(shape) });

const SAVE_LABEL = { saved: '已保存', saving: '保存中…', failed: '没保存上' } as const;

export function MapEditor({
  map,
  locations,
  desktop,
  onDone,
}: {
  map: HouseholdMap;
  locations: StorageLocation[];
  desktop: boolean;
  onDone: () => void;
}) {
  const canvas = useRef<MapCanvasHandle>(null);
  const background = useMapBackground(map);
  const saver = useShapeSaver();
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const [tool, setTool] = useState<MapTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [showBackground, setShowBackground] = useState(true);
  const [drawn, setDrawn] = useState<{ kind: 'room' | 'container'; shape: MapShape; parentId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; run: () => void } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const mode: MapMode = desktop ? 'edit-full' : 'edit-containers';

  // 盖住整个应用：body 不滚
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const byId = useMemo(() => new Map(locations.map((one) => [one.id, one])), [locations]);
  const items = useMemo(() => locations.map(itemOf).filter((one): one is MapItem => one !== null), [locations]);
  const rooms = useMemo(
    () =>
      locations
        .filter((one) => one.kind === 'room' && !one.archivedAt && !one.systemKey)
        .sort((a, b) => Number(Boolean(b.mapShape)) - Number(Boolean(a.mapShape))),
    [locations],
  );
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const selectedShape = selected?.mapShape ?? null;

  const select = (id: string | null) => {
    setRenaming(false);
    setSelectedId(id);
    // 手机上柜子在全图里太小，选中就放大对准它（让开底部工具栏）
    const shape = id ? byId.get(id)?.mapShape : null;
    if (!desktop && shape && byId.get(id!)?.kind !== 'room') canvas.current?.focus(shapeBounds(shape), 3.5, { bottom: 96 });
  };

  // Esc：先退出改名，再取消选中；不退出编辑（防手滑，退出只认「完成」和后退）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      if (renaming) setRenaming(false);
      else setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [renaming]);

  /** 这个位置和它下面所有位置 */
  const subtree = (id: string): StorageLocation[] => {
    const out: StorageLocation[] = [];
    const walk = (parent: string) => {
      for (const one of locations) {
        if (one.parentId === parent && !one.archivedAt) {
          out.push(one);
          walk(one.id);
        }
      }
    };
    walk(id);
    return out;
  };

  const askRemove = (location: StorageLocation) => {
    const below = subtree(location.id);
    const shapedBelow = below.filter((one) => one.mapShape);
    const things = [location, ...below].reduce((sum, one) => sum + one.itemCount, 0);
    const room = location.kind === 'room';
    const body = room
      ? `「${location.name}」${shapedBelow.length ? `和里面 ${shapedBelow.length} 个柜子` : ''}从地图上拿掉。位置${things ? `和记着的 ${things} 件东西` : ''}都还在清单里，入库照样选得到；要再显示得重新画上去，拿掉后不能撤销。`
      : `「${location.name}」从地图上拿掉。它${things ? `和里面记着的 ${things} 件东西` : ''}还在清单里（${location.pathLabel}）；拿掉后不能撤销。`;
    setConfirm({
      title: `从图上拿掉「${location.name}」？`,
      body,
      action: '拿掉',
      run: () => {
        saver.save([...shapedBelow.map((one) => ({ id: one.id, shape: null })), { id: location.id, shape: null }]);
        void saver.flush();
        select(null);
      },
    });
  };

  const rotate = (location: StorageLocation) => {
    const shape = location.mapShape;
    if (shape?.type !== 'rect') return;
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    const turned = { type: 'rect' as const, x: Math.round(cx - shape.h / 2), y: Math.round(cy - shape.w / 2), w: shape.h, h: shape.w };
    const parent = location.parentId ? byId.get(location.parentId)?.mapShape : null;
    const b = parent ? shapeBounds(parent) : null;
    if (b && (turned.x < b.minX || turned.y < b.minY || turned.x + turned.w > b.maxX || turned.y + turned.h > b.maxY)) {
      pushToast('转过来会出房间，先往中间挪一挪');
      return;
    }
    saver.save([{ id: location.id, shape: turned }]);
  };

  const actionsFor = (location: StorageLocation): ToolbarAction[] => {
    const list: ToolbarAction[] = [{ key: 'rename', label: '改名', onClick: () => setRenaming(true) }];
    if (location.kind !== 'room' && location.mapShape?.type === 'rect') list.push({ key: 'rotate', label: '↻ 90°', onClick: () => rotate(location) });
    list.push({ key: 'remove', label: '删除', danger: true, onClick: () => askRemove(location) });
    return list;
  };

  const place = async (location: StorageLocation) => {
    if (!drawn) return;
    const shape = drawn.shape;
    setDrawn(null);
    setTool('select');
    await saver.saveNow([{ id: location.id, shape }]);
    select(location.id);
    navigator.vibrate?.(10);
  };
  const siblings = drawn ? locations.filter((one) => one.parentId === drawn.parentId && !one.archivedAt && !one.systemKey) : [];

  const done = async () => {
    setLeaving(true);
    await saver.flush();
    onDone();
  };

  const tools: EditorTool[] = [
    { key: 'select', label: '选择', icon: '↖', active: tool === 'select', onClick: () => setTool('select') },
    ...(desktop
      ? [
          { key: 'room', label: '画房间', icon: '▭', active: tool === 'room', onClick: () => { select(null); setTool('room'); } },
          { key: 'container', label: '画柜子', icon: '▤', active: tool === 'container', onClick: () => { select(null); setTool('container'); } },
        ]
      : []),
    { key: 'fit', label: '看全图', icon: '⤢', separated: true, onClick: () => canvas.current?.reset() },
  ];

  const topSafe = desktop ? 72 : 60;
  const bottomSafe = desktop ? 16 : 96;

  return createPortal(
    <div data-map-editor className="fixed inset-0 z-40 bg-bg motion-safe:animate-[float-in_180ms_cubic-bezier(0,0,0.2,1)]">
      <MapCanvas
        ref={canvas}
        label="编辑家庭地图"
        viewBox={map.viewBox}
        items={items}
        background={showBackground ? background : null}
        backgroundOpacity={0.45}
        mode={mode}
        tool={tool}
        selectedId={selectedId}
        onSelect={select}
        onShapesChange={saver.save}
        onDraw={(kind, rect, parentId) => setDrawn({ kind, parentId, shape: kind === 'room' ? toPolygon(rect) : rect })}
        onHint={pushToast}
        floating={({ toScreen, size, moving }) => {
          if (!selected || !selectedShape || !size) return null;
          const box = toScreen(shapeBounds(selectedShape));
          if (!box) return null;
          // 外扩一圈：顶点 / 四角的手柄也不压
          const anchor = { left: box.left - 12, top: box.top - 12, right: box.right + 12, bottom: box.bottom + 12 };
          return (
            <FloatingToolbar
              key={selected.id}
              anchor={anchor}
              size={size}
              moving={moving}
              topSafe={topSafe}
              bottomSafe={bottomSafe}
              actions={actionsFor(selected)}
              rename={
                renaming
                  ? {
                      value: selected.name,
                      onCancel: () => setRenaming(false),
                      onSubmit: (name) => {
                        setRenaming(false);
                        if (name && name !== selected.name) {
                          update.mutate({ id: selected.id, name }, { onError: (error) => pushToast(error.message) });
                        }
                      },
                    }
                  : null
              }
            />
          );
        }}
      />
      <RoomDrawer
        rooms={rooms}
        locations={locations}
        selectedId={selectedId}
        background={map.hasBackground ? { shown: showBackground, toggle: () => setShowBackground(!showBackground) } : undefined}
        onPick={(id) => {
          select(id);
          const shape = byId.get(id)?.mapShape;
          if (shape) canvas.current?.focus(shapeBounds(shape), 2);
          else pushToast('这间还没画到图上');
        }}
      />
      <EditorToolbar tools={tools} desktop={desktop} />
      <div className="absolute right-3 top-3 z-20 flex items-center gap-3 lg:right-4 lg:top-4">
        <span data-map-save-status={saver.status} className={'hidden text-[12.5px] sm:inline ' + (saver.status === 'failed' ? 'text-danger' : 'text-ink-soft')}>
          {SAVE_LABEL[saver.status]}
        </span>
        <Button className="h-10 min-h-10 px-5 shadow-md" disabled={leaving} onClick={() => void done()}>
          {leaving ? '保存中…' : '完成'}
        </Button>
      </div>
      {desktop ? (
        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5">
          <Button variant="ghost" aria-label="放大" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.zoomBy(1.4)}>＋</Button>
          <Button variant="ghost" aria-label="缩小" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.zoomBy(1 / 1.4)}>－</Button>
        </div>
      ) : null}
      {tool !== 'select' ? (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 mx-auto w-fit rounded-full bg-surface/90 px-3 py-1.5 text-[12.5px] text-ink-soft shadow-sm backdrop-blur">
          {tool === 'room' ? '在图上拖一个矩形画房间，画完再拖顶点修形状' : '在房间里拖一个矩形画柜子'}
        </p>
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
      {confirm ? (
        <Dialog
          title={confirm.title}
          onClose={() => setConfirm(null)}
          maxWidth={400}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>取消</Button>
              <Button className="bg-danger hover:bg-danger" onClick={() => { confirm.run(); setConfirm(null); navigator.vibrate?.(12); }}>
                {confirm.action}
              </Button>
            </div>
          }
        >
          <p className="text-[14px] leading-relaxed text-ink-soft">{confirm.body}</p>
        </Dialog>
      ) : null}
    </div>,
    document.body,
  );
}
