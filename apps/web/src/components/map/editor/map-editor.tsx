import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HouseholdMap, MapShape, StorageLocation } from '@family/contracts';
import { shapeBounds } from '@family/shared';
import { useCreateLocation, useMapBackground } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import { Button, Dialog } from '../../ui';
import { MapCanvas, type MapCanvasHandle } from '../map-canvas';
import { MapNameDialog } from '../map-name-dialog';
import type { MapItem, MapMode, MapTool } from '../map-types';
import { useShapeSaver } from '../use-shape-saver';
import { EditorToolbar, type EditorTool } from './editor-toolbar';
import { FloatingToolbar, type MoreAction, type ToolbarAction } from './floating-toolbar';
import { RoomDrawer } from './room-drawer';
import { aligned, neighbourPoints, rectangularized, removalPlan, toPolygon, turned, withoutVertex } from './shape-actions';
import { useEditorHistory } from './use-editor-history';

// 全屏沉浸的地图编辑器（docs/ui-prototypes/map-editor-v2.md §1）：portal 盖在整个应用之上，
// 隐藏标题、左树、底部导航；只留一条工具栏、左上房间抽屉、右上「完成」。选中什么就在它旁边出浮动小工具条。
// 电脑上什么都能改；手机上房间形状不动，柜子 / 家具能拖、拉、转、改名、删（v2 拍板 1）。
// 改形状、改名、新画的都能撤销（§4，最多 50 步）；从图上拿掉先确认、不进撤销栈（拍板 2）。

function itemOf(location: StorageLocation): MapItem | null {
  if (!location.mapShape || location.archivedAt || location.kind === 'slot') return null;
  return { id: location.id, parentId: location.parentId, kind: location.kind, name: location.name, shape: location.mapShape };
}

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
  const { history, commitShapes, rename } = useEditorHistory({ locations, saver });
  const [tool, setTool] = useState<MapTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
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
    setVertex(null);
    setSelectedId(id);
    // 手机上柜子在全图里太小，选中就放大对准它（让开底部工具栏）
    const shape = id ? byId.get(id)?.mapShape : null;
    if (!desktop && shape && byId.get(id!)?.kind !== 'room') canvas.current?.focus(shapeBounds(shape), 3.5, { bottom: 96 });
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
        if (renaming) setRenaming(false);
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

  const rotate = (location: StorageLocation) => {
    const next = location.mapShape ? turned(location.mapShape, location.parentId ? byId.get(location.parentId)?.mapShape : null) : null;
    if (next) commitShapes([{ id: location.id, shape: next }], '转 90°');
    else pushToast('转过来会出房间，先往中间挪一挪');
  };

  const actionsFor = (location: StorageLocation): ToolbarAction[] => {
    const list: ToolbarAction[] = [{ key: 'rename', label: '改名', onClick: () => setRenaming(true) }];
    if (location.kind !== 'room' && location.mapShape?.type === 'rect') list.push({ key: 'rotate', label: '↻ 90°', onClick: () => rotate(location) });
    list.push({ key: 'remove', label: '删除', danger: true, onClick: () => askRemove(location) });
    return list;
  };

  /** 房间的「更多」：形状类操作只在电脑上（拍板 1），手机上置灰并提示 */
  const moreFor = (location: StorageLocation): MoreAction[] => {
    if (location.kind !== 'room' || !location.mapShape) return [];
    const shape = location.mapShape;
    const onlyDesktop = desktop ? undefined : '在电脑上做';
    return [
      { key: 'rect', label: '矩形化', hint: onlyDesktop ?? '外接矩形', disabled: !desktop, onClick: () => commitShapes([{ id: location.id, shape: rectangularized(shape) }], '矩形化') },
      {
        key: 'align',
        label: '对齐相邻',
        hint: onlyDesktop ?? '拉齐公共墙',
        disabled: !desktop,
        onClick: () => {
          const result = aligned(shape, neighbourPoints(locations, location.id));
          if (!result) pushToast('旁边没有贴得够近的墙');
          else {
            commitShapes([{ id: location.id, shape: result.shape }], '对齐相邻');
            pushToast(`拉齐了 ${result.moved} 面墙`);
          }
        },
      },
    ];
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
    await saver.flush();
    onDone();
  };

  const step = (direction: 'undo' | 'redo') => {
    setVertex(null);
    setRenaming(false);
    void (direction === 'undo' ? history.undo() : history.redo());
  };
  const tools: EditorTool[] = [
    { key: 'select', label: '选择', icon: '↖', active: tool === 'select', onClick: () => setTool('select') },
    ...(desktop
      ? [
          { key: 'room', label: '画房间', icon: '▭', active: tool === 'room', onClick: () => { select(null); setTool('room'); } },
          { key: 'container', label: '画柜子', icon: '▤', active: tool === 'container', onClick: () => { select(null); setTool('container'); } },
        ]
      : [{ key: 'fit', label: '看全图', icon: '⤢', onClick: () => canvas.current?.reset() }]),
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
        tool={tool}
        selectedId={selectedId}
        selectedVertex={vertex}
        onVertexSelect={setVertex}
        onSelect={select}
        onShapesChange={(changes) => commitShapes(changes, '改形状')}
        onDraw={(kind, rect, parentId) => setDrawn({ kind, parentId, shape: kind === 'room' ? toPolygon(rect) : rect })}
        onHint={pushToast}
        floating={({ toScreen, size, moving }) => {
          if (!selected || !selectedShape || !size) return null;
          // 点选了顶点：工具条贴着那个点，只有「删这个点」「取消」
          const point = vertex !== null && selectedShape.type === 'polygon' ? selectedShape.points[vertex] : null;
          const box = toScreen(point ? { minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] } : shapeBounds(selectedShape));
          if (!box) return null;
          // 外扩一圈：顶点 / 四角的手柄也不压
          const anchor = { left: box.left - 12, top: box.top - 12, right: box.right + 12, bottom: box.bottom + 12 };
          return (
            <FloatingToolbar
              key={`${selected.id}:${vertex ?? ''}`}
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
                  : actionsFor(selected)
              }
              more={point ? undefined : moreFor(selected)}
              rename={
                renaming
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
          <Button variant="ghost" aria-label="看全图" className="size-11 border border-border bg-surface/90 p-0 backdrop-blur" onClick={() => canvas.current?.reset()}>⤢</Button>
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
          onPickExisting={(location) => void place(location, false)}
          onCreate={(name) =>
            create.mutate(
              { parentId: drawn.parentId, name, kind: drawn.kind === 'room' ? undefined : 'container' },
              { onSuccess: (location) => void place(location, true), onError: (error) => pushToast(error.message) },
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
