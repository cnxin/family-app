import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HouseholdMap, MapShape, StorageLocation } from '@family/contracts';
import { shapeBounds } from '@family/shared';
import { useCreateLocation, useMapBackground } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import { Button } from '../../ui';
import { MapCanvas, type MapCanvasHandle } from '../map-canvas';
import { MapNameDialog } from '../map-name-dialog';
import { placementRect, type FurnitureSpec } from '../furniture-catalog';
import { mapItems } from '../map-items';
import type { MapMode, MapTool } from '../map-types';
import { useShapeSaver } from '../use-shape-saver';
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog';
import { EditorToolbar, ZoomControls, type EditorTool } from './editor-toolbar';
import { FloatingToolbar } from './floating-toolbar';
import { FurniturePanel } from './furniture-panel';
import { objectActions, type Selection } from './object-actions';
import { RoomDrawer } from './room-drawer';
import { removalPlan, toPolygon, withoutVertex } from './shape-actions';
import { useDecorations } from './use-decorations';
import { useEditorHistory } from './use-editor-history';
import { useFurniture } from './use-furniture';
import { useRoomRestructure } from './use-room-restructure';
import { SplitDialog } from './split-dialog';

// 全屏沉浸的地图编辑器（docs/ui-prototypes/map-editor-v2.md §1）：portal 盖在整个应用之上，
// 隐藏标题、左树、底部导航；只留一条工具栏、左上房间抽屉、右上「完成」。选中什么就在它旁边出浮动小工具条。
// 电脑上什么都能改；手机上房间形状不动，柜子 / 家具能拖、拉、转、改名、删（v2 拍板 1）。
// 改形状、改名、新画的、家具的放 / 挪 / 删都能撤销（§4，最多 50 步）；从图上拿掉先确认、不进撤销栈（拍板 2）。
// 家具库（§3）：电脑上左侧面板、手机上底部 sheet；收纳类落成带图标的柜子，装饰类整列存在地图上。

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
  const decor = useDecorations(map);
  const { history, commitShapes, commitDecor, rename, setIcon } = useEditorHistory({ locations, saver, decor });
  const [tool, setTool] = useState<MapTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [showBackground, setShowBackground] = useState(true);
  const [drawn, setDrawn] = useState<{ kind: 'room' | 'container'; shape: MapShape; parentId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [snap, setSnap] = useState(true);
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
  const items = useMemo(() => mapItems(locations, decor.items), [locations, decor.items]);
  const rooms = useMemo(
    () =>
      locations
        .filter((one) => one.kind === 'room' && !one.archivedAt && !one.systemKey)
        .sort((a, b) => Number(Boolean(b.mapShape)) - Number(Boolean(a.mapShape))),
    [locations],
  );
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const selectedDecor = selectedId && !selected ? decor.items.find((one) => one.id === selectedId) ?? null : null;
  const selection: Selection | null = selected ? { type: 'location', location: selected } : selectedDecor ? { type: 'decor', decor: selectedDecor } : null;
  const shapeOf = (id: string | null) => (id ? items.find((one) => one.id === id)?.shape ?? null : null);
  const selectedShape = shapeOf(selectedId);

  const pick = (id: string | null) => {
    setRenaming(false);
    setVertex(null);
    setSelectedId(id);
    // 手机上柜子在全图里太小，选中就放大对准它（让开底部工具栏）
    const shape = shapeOf(id);
    if (!desktop && shape && byId.get(id!)?.kind !== 'room') canvas.current?.focus(shapeBounds(shape), 3.5, { bottom: 96 });
  };
  const furniture = useFurniture({
    locations,
    decorations: decor.items,
    selectedId,
    centre: () => canvas.current?.centre() ?? null,
    push: history.push,
    commitDecor,
    setIcon,
    saveNow: saver.saveNow,
    select: pick,
    focus: (shape) => {
      if (!desktop) canvas.current?.focus(shapeBounds(shape), 3.5, { bottom: 96 });
    },
  });
  const restructure = useRoomRestructure({ locations, viewBox: map.viewBox, snap, select: pick, confirm: setConfirm });
  /** 「挪到别的房间…」「合并到…」之后点的那一下：点到房间就挪 / 并过去，点别处就算取消 */
  const select = (id: string | null) => {
    if (restructure.merging) return restructure.pickTarget(id);
    if (furniture.relocating) {
      if (id && byId.get(id)?.kind === 'room') void furniture.relocate(id);
      else furniture.setRelocating(null);
      return;
    }
    pick(id);
  };

  const deleteVertex = () => {
    if (!selected || !selectedShape || vertex === null) return;
    const next = withoutVertex(selectedShape, vertex);
    if (!next) {
      pushToast('房间至少要 3 个顶点');
      return;
    }
    commitShapes([{ id: selected.id, shape: next }], '删顶点');
    setVertex(null);
  };

  // Esc：先退出改名 / 取消点选的顶点，再取消选中；不退出编辑（防手滑）。Delete / Backspace：删点选的顶点
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]') || (event.target as HTMLElement | null)?.closest('input, textarea')) return;
      if (event.key === 'Escape') {
        if (furniture.relocating || restructure.splitting || restructure.merging) {
          furniture.setRelocating(null);
          restructure.cancel();
        }
        else if (renaming) setRenaming(false);
        else if (vertex !== null) setVertex(null);
        else setSelectedId(null);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && vertex !== null) {
        event.preventDefault();
        deleteVertex();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const askRemove = (location: StorageLocation) => {
    const plan = removalPlan(locations, location);
    setConfirm({
      title: `从图上拿掉「${location.name}」？`,
      body: plan.body,
      action: '拿掉',
      run: () => {
        saver.save(plan.ids.map((id) => ({ id, shape: null })));
        void saver.flush();
        select(null);
      },
    });
  };

  const place = async (location: StorageLocation, created: boolean) => {
    if (!drawn) return;
    const shape = drawn.shape;
    setDrawn(null);
    setTool('select');
    if (created) {
      history.push({ kind: 'create', label: '新画', id: location.id, parentId: location.parentId, name: location.name, locationKind: drawn.kind, shape });
      await saver.saveNow([{ id: location.id, shape }]);
    } else commitShapes([{ id: location.id, shape }], '画上去');
    select(location.id);
    navigator.vibrate?.(10);
  };
  const siblings = drawn ? locations.filter((one) => one.parentId === drawn.parentId && !one.archivedAt && !one.systemKey) : [];

  const done = async () => {
    setLeaving(true);
    await Promise.all([saver.flush(), decor.flush()]);
    onDone();
  };

  const onPick = async (spec: FurnitureSpec) => {
    const mode = furniture.panel;
    if (mode?.type === 'replace') {
      if (selectedId) furniture.replace(selectedId, spec);
      furniture.setPanel(null);
      return;
    }
    const placed = await furniture.place(spec);
    if (placed && !desktop) furniture.setPanel(null);
  };
  /** 自定义柜子：电脑上拖矩形画；手机上在房间中央放一个默认框再起名 */
  const onCustom = () => {
    furniture.setPanel(null);
    if (desktop) {
      pick(null);
      setTool('container');
      return;
    }
    const room = furniture.room;
    const rect = room ? placementRect({ w: 80, h: 45 }, room.mapShape!) : null;
    if (!room || !rect) pushToast(room ? '这间太小了' : '先在图上点一个房间');
    else setDrawn({ kind: 'container', parentId: room.id, shape: rect });
  };

  const step = (direction: 'undo' | 'redo') => {
    setVertex(null);
    setRenaming(false);
    void (direction === 'undo' ? history.undo() : history.redo());
  };
  const tools: EditorTool[] = [
    { key: 'select', label: '选择', icon: '↖', active: tool === 'select', onClick: () => setTool('select') },
    ...(desktop ? [{ key: 'room', label: '画房间', icon: '▭', active: tool === 'room', onClick: () => { pick(null); setTool('room'); } }] : []),
    {
      key: 'furniture',
      label: desktop ? '家具库' : '家具',
      icon: '▦',
      active: furniture.panel?.type === 'add' || tool === 'container',
      onClick: () => {
        setTool('select');
        furniture.setPanel(furniture.panel?.type === 'add' ? null : { type: 'add' });
      },
    },
    ...(desktop ? [] : [{ key: 'fit', label: '看全图', icon: '⤢', onClick: () => canvas.current?.reset() }]),
    { key: 'undo', label: '撤销', icon: '↶', separated: true, disabled: !history.canUndo, onClick: () => step('undo') },
    { key: 'redo', label: '重做', icon: '↷', disabled: !history.canRedo, onClick: () => step('redo') },
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
        tool={restructure.splitting ? 'split' : tool}
        onLine={restructure.onLine}
        ghost={restructure.plan ? { type: 'polygon', points: restructure.plan.piece } : null}
        highlightIds={restructure.mergeTargets}
        selectedId={selectedId}
        selectedVertex={vertex}
        onVertexSelect={setVertex}
        onSelect={select}
        snap={snap}
        onShapesChange={(changes) => commitShapes(changes, '改形状')}
        onDraw={(kind, rect, parentId) => setDrawn({ kind, parentId, shape: kind === 'room' ? toPolygon(rect) : rect })}
        onHint={pushToast}
        floating={({ toScreen, size, moving }) => {
          if (!selection || !selectedShape || !size || furniture.relocating || restructure.splitting || restructure.merging || restructure.plan) return null;
          // 点选了顶点：工具条贴着那个点，只有「删这个点」「取消」
          const point = vertex !== null && selectedShape.type === 'polygon' ? selectedShape.points[vertex] : null;
          const box = toScreen(point ? { minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] } : shapeBounds(selectedShape));
          if (!box) return null;
          // 外扩一圈：顶点 / 四角的手柄也不压
          const anchor = { left: box.left - 12, top: box.top - 12, right: box.right + 12, bottom: box.bottom + 12 };
          const { actions, more } = objectActions(selection, {
            desktop,
            locations,
            decorations: decor.items,
            snap,
            setSnap,
            rename: () => setRenaming(true),
            askRemove,
            commitShapes,
            commitDecor,
            openPanel: furniture.setPanel,
            relocate: (id) => furniture.setRelocating(id),
            deselect: () => pick(null),
            split: restructure.startSplit,
            merge: restructure.startMerge,
          });
          return (
            <FloatingToolbar
              key={`${selectedId}:${vertex ?? ''}`}
              anchor={anchor}
              size={size}
              moving={moving}
              topSafe={topSafe}
              bottomSafe={bottomSafe}
              actions={
                point
                  ? [
                      { key: 'delete-vertex', label: '删这个点', danger: true, onClick: deleteVertex },
                      { key: 'cancel', label: '取消', onClick: () => setVertex(null) },
                    ]
                  : actions
              }
              more={point ? undefined : more}
              rename={
                renaming && selected
                  ? {
                      value: selected.name,
                      onCancel: () => setRenaming(false),
                      onSubmit: (name) => {
                        setRenaming(false);
                        if (name && name !== selected.name) rename(selected, name);
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
        collapsed={desktop && Boolean(furniture.panel)}
        background={map.hasBackground ? { shown: showBackground, toggle: () => setShowBackground(!showBackground) } : undefined}
        onPick={(id) => {
          pick(id);
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
      {desktop ? <ZoomControls onZoom={(factor) => canvas.current?.zoomBy(factor)} onFit={() => canvas.current?.reset()} /> : null}
      {tool !== 'select' || furniture.relocating || restructure.splitting || restructure.merging ? (
        <p role="status" className="pointer-events-none absolute inset-x-0 top-[72px] z-10 mx-auto w-fit rounded-full bg-surface/90 px-3 py-1.5 text-[12.5px] text-ink-soft shadow-sm backdrop-blur">
          {restructure.splitting
            ? '从一面墙拖到另一面墙，把房间切成两块（Esc 取消）'
            : restructure.merging
              ? '点一间高亮的房间，把选中的并进去（Esc 取消）'
              : furniture.relocating ? '点一下要挪去的房间（Esc 取消）' : tool === 'room' ? '在图上拖一个矩形画房间，画完再拖顶点修形状' : '在房间里拖一个矩形画柜子'}
        </p>
      ) : null}
      {furniture.panel ? (
        <FurniturePanel
          desktop={desktop}
          mode={furniture.panel}
          roomName={furniture.room?.name ?? null}
          onPick={(spec) => void onPick(spec)}
          onCustom={onCustom}
          onClose={() => furniture.setPanel(null)}
        />
      ) : null}
      {drawn ? (
        <MapNameDialog
          kind={drawn.kind}
          unplaced={siblings.filter((one) => !one.mapShape && (drawn.kind === 'room' ? one.kind === 'room' : one.kind !== 'slot'))}
          taken={siblings.map((one) => one.name)}
          busy={create.isPending}
          onClose={() => setDrawn(null)}
          onPickExisting={(location) => void place(location, false)}
          onCreate={(name) =>
            create.mutate(
              { parentId: drawn.parentId, name, kind: drawn.kind === 'room' ? undefined : 'container' },
              { onSuccess: (location) => void place(location, true), onError: (error) => pushToast(error.message, undefined, 'error') },
            )
          }
        />
      ) : null}
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
      {restructure.plan ? (
        <SplitDialog
          roomName={restructure.plan.room.name}
          consequence={restructure.plan.consequence}
          taken={locations.filter((one) => one.kind === 'room' && !one.archivedAt).map((one) => one.name)}
          busy={restructure.busy}
          onClose={restructure.closePlan}
          onConfirm={(name) => void restructure.confirmSplit(name)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
