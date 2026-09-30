import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { MapRect, MapShape } from '@family/contracts';
import { clampRect, pointInShape, shapeBounds, shapePoints, type MapBounds, type MapPoint, type MapSegment } from '@family/shared';
import { dragStep, nearestEdge, pathOf, type Drag } from './canvas-drag';
import { MapDrawOverlay, MapHandles, MapInner, MapLabels } from './map-layers';
import type { MapItem, MapMode, MapTool, ShapeChange } from './map-types';
import { useMapViewport } from './use-map-viewport';

// 家庭地图画布（item-location-plan §3 I2b）：SVG 自写，不引画布库。
// 看：点房间、点柜子、命中高亮；编辑：拖顶点、双击边加顶点、右键删顶点、拖房间（里面的柜子跟着走）、
// 拖 / 缩放柜子、拖一个矩形画新房间或柜子。拖动时只在本地预览，松手才交给上层（上层防抖保存）。

const MIN_DRAW = 12;

/** 手柄半径（屏幕 px）：手指大一点，但不超过对象短边的三分之一，免得小柜子被四个角盖满 */
function handleSize(shape: MapShape, scale: number, coarse: boolean) {
  const b = shapeBounds(shape);
  const short = Math.min(b.maxX - b.minX, b.maxY - b.minY) * scale;
  return Math.max(5, Math.min(coarse ? 11 : 6, short / 3));
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FloatingContext {
  toScreen: (bounds: MapBounds) => ScreenRect | null;
  /** 画布在屏幕上的大小 */
  size: { w: number; h: number } | null;
  /** 正在平移 / 捏合 / 拖对象：浮层先藏起来 */
  moving: boolean;
}

export interface MapCanvasHandle {
  focus: (bounds: MapBounds, maxZoom?: number, inset?: { right?: number; bottom?: number }) => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
  /** 屏幕中心在地图上的点（家具库没选房间时按它找房间） */
  centre: () => MapPoint | null;
}

interface Props {
  viewBox: { w: number; h: number };
  items: MapItem[];
  background?: string | null;
  backgroundOpacity?: number;
  mode: MapMode;
  tool?: MapTool;
  selectedId: string | null;
  /** 搜索命中：高亮描边 */
  highlightIds?: Set<string>;
  onSelect: (id: string | null) => void;
  onShapesChange?: (changes: ShapeChange[]) => void;
  onDraw?: (kind: 'room' | 'container', rect: MapRect, parentId: string | null) => void;
  /** 拆分：拖完的那条线（未拉正） */
  onLine?: (start: MapPoint, end: MapPoint) => void;
  /** 虚线预览的一块（拆分时切出来的那块） */
  ghost?: MapShape | null;
  /** 点选了房间的一个顶点（没拖）：编辑器出「删这个点」；null = 取消 */
  onVertexSelect?: (index: number | null) => void;
  selectedVertex?: number | null;
  /** 顶点编辑之外的提示（比如「柜子要画在房间里」） */
  onHint?: (message: string) => void;
  /** 吸附开关（「更多 → 吸附墙边」）；按住 Alt 也临时不吸 */
  snap?: boolean;
  /** 盖在画布上的按钮（缩放、工具条） */
  overlay?: ReactNode;
  /**
   * 跟着对象走的浮层（编辑器的浮动小工具条）：拿到「地图坐标 → 画布内屏幕坐标」的换算和「正在拖 / 捏」，
   * 每一帧跟着画布重画，缩放平移时位置不会落后。
   */
  floating?: (context: FloatingContext) => ReactNode;
  label: string;
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { viewBox, items, background, backgroundOpacity = 1, mode, tool = 'select', selectedId, highlightIds, onSelect, onShapesChange, onDraw, onLine, ghost, onVertexSelect, selectedVertex = null, onHint, snap = true, overlay, floating, label },
  ref,
) {
  const viewport = useMapViewport(viewBox);
  // 本地预览只对当时那份 items 有效：上层数据一变（保存回来、别处改了）预览自动作废。上层要 useMemo 住 items。
  const [preview, setPreviewState] = useState<{ base: MapItem[]; shapes: Map<string, MapShape> }>({ base: items, shapes: new Map() });
  const [drawing, setDrawing] = useState<{ start: MapPoint; end: MapPoint; line: boolean } | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef<Map<string, MapShape>>(new Map());
  const suppress = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [guides, setGuides] = useState<MapSegment[]>([]);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: viewport.focus,
      reset: viewport.reset,
      zoomBy: (factor: number) => void viewport.zoomBy(factor),
      centre: () => {
        const v = viewport.view;
        const size = viewport.size;
        return v && size ? [(size.w / 2 - v.x) / v.scale, (size.h / 2 - v.y) / v.scale] : null;
      },
    }),
    [viewport],
  );

  const live = preview.base === items ? preview.shapes : null;
  const setPreview = (shapes: Map<string, MapShape>) => {
    latest.current = shapes;
    setPreviewState({ base: items, shapes });
  };
  const shapeOf = (item: MapItem) => live?.get(item.id) ?? item.shape;
  const rooms = items.filter((item) => item.kind === 'room');
  const inner = items.filter((item) => item.kind !== 'room');
  const roomIndex = new Map(rooms.map((room, i) => [room.id, i]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const scale = viewport.view?.scale ?? 1;
  const unit = 1 / scale;
  const editing = mode !== 'view';
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  /** 吸附用：柜子 → 同房间其他柜子；房间 → 其他房间（外接框） */
  const siblingBounds = (item: MapItem) =>
    (item.kind === 'room' ? rooms : inner.filter((one) => one.parentId === item.parentId))
      .filter((one) => one.id !== item.id)
      .map((one) => shapeBounds(shapeOf(one)));

  const roomAt = (point: MapPoint) =>
    [...rooms].reverse().find((room) => pointInShape(point, shapeOf(room))) ?? null;

  const begin = (event: PointerEvent, next: Drag) => {
    event.stopPropagation();
    drag.current = next;
    const move = (e: globalThis.PointerEvent) => update(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const update = (event: globalThis.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = dragStep(d, viewport.toMap(event.clientX, event.clientY), viewBox, scale, snap && !event.altKey);
    if (next === 'draw' && d.type === 'draw') setDrawing({ start: d.start, end: d.end, line: d.kind === 'line' });
    else if (next && next !== 'draw') {
      setPreview(next.shapes);
      setGuides(next.guides);
      setDragging(true);
    }
  };

  const finish = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setGuides([]);
    if (!d) return;
    if (d.type === 'vertex' && !d.started) {
      onVertexSelect?.(d.index);
      suppress.current = true;
      return;
    }
    // 这一下松手之后浏览器还会补一个 click，别让它再去选中 / 取消选中
    suppress.current = d.type !== 'move' || d.started;
    if (d.type === 'vertex' || d.type === 'resize' || d.type === 'move') onVertexSelect?.(null);
    if (d.type === 'draw') {
      setDrawing(null);
      if (d.kind === 'line') {
        if (Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) * scale >= MIN_DRAW) onLine?.(d.start, d.end);
        return;
      }
      const rect = {
        type: 'rect' as const,
        x: Math.min(d.start[0], d.end[0]),
        y: Math.min(d.start[1], d.end[1]),
        w: Math.abs(d.end[0] - d.start[0]),
        h: Math.abs(d.end[1] - d.start[1]),
      };
      if (rect.w * scale < MIN_DRAW || rect.h * scale < MIN_DRAW) return;
      const parent = d.parentId ? byId.get(d.parentId) : null;
      onDraw?.(d.kind as 'room' | 'container', parent ? clampRect(rect, shapeBounds(shapeOf(parent))) : rect, d.parentId);
      return;
    }
    const changed = latest.current;
    latest.current = new Map();
    if (changed.size && (d.type !== 'move' || d.started)) {
      onShapesChange?.([...changed].map(([id, shape]) => ({ id, shape })));
    }
  };

  const startDraw = (event: PointerEvent<HTMLElement>) => {
    if (mode !== 'edit-full' || tool === 'select' || event.button !== 0) return false;
    // 起点也要夹进图里：从图外面开始拖会出负坐标，服务端拒收
    const [sx, sy] = viewport.toMap(event.clientX, event.clientY);
    const start: MapPoint = [Math.round(Math.min(viewBox.w, Math.max(0, sx))), Math.round(Math.min(viewBox.h, Math.max(0, sy)))];
    let parentId: string | null = null;
    if (tool === 'container') {
      const room = roomAt(start);
      if (!room) {
        onHint?.('柜子要画在房间里：从房间里面开始拖');
        return true;
      }
      parentId = room.id;
    }
    const kind = tool === 'split' ? 'line' : tool;
    begin(event, { type: 'draw', kind, parentId, start, end: start });
    setDrawing({ start, end: start, line: kind === 'line' });
    return true;
  };

  const pressItem = (event: PointerEvent, item: MapItem) => {
    if (!editing || event.button !== 0 || tool !== 'select') return;
    const canMove = item.kind === 'room' ? mode === 'edit-full' && item.id === selectedId : true;
    if (!canMove) return;
    const ids = item.kind === 'room' ? [item.id, ...inner.filter((one) => one.parentId === item.id).map((one) => one.id)] : [item.id];
    const parent = item.parentId ? byId.get(item.parentId) : null;
    begin(event, {
      type: 'move',
      ids,
      origin: viewport.toMap(event.clientX, event.clientY),
      shapes: new Map(ids.map((id) => [id, shapeOf(byId.get(id)!)])),
      clamp: parent ? shapeBounds(shapeOf(parent)) : null,
      siblings: siblingBounds(item),
      started: false,
    });
  };

  const keySelect = (event: KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
    }
  };

  const selectedShape = selected ? shapeOf(selected) : null;

  return (
    <div
      ref={viewport.container}
      role="application"
      aria-label={label}
      data-map-canvas={mode}
      className={'relative h-full w-full touch-none select-none overflow-hidden ' + (editing && tool !== 'select' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
      onPointerDownCapture={() => {
        suppress.current = false;
      }}
      onPointerDown={(event) => {
        if (!startDraw(event)) viewport.handlers.onPointerDown(event);
      }}
      onClickCapture={(event) => {
        if (suppress.current) {
          suppress.current = false;
          event.stopPropagation();
          return;
        }
        viewport.handlers.onClickCapture(event);
      }}
      onContextMenu={(event) => editing && event.preventDefault()}
    >
      {viewport.view ? (
        <svg className="absolute inset-0 h-full w-full" onClick={() => onSelect(null)}>
          <g transform={`translate(${viewport.view.x} ${viewport.view.y}) scale(${scale})`}>
            <rect width={viewBox.w} height={viewBox.h} rx={8 * unit} className="fill-surface" />
            {background ? (
              <image href={background} width={viewBox.w} height={viewBox.h} preserveAspectRatio="none" opacity={backgroundOpacity} />
            ) : null}
            {rooms.map((room) => {
              const shape = shapeOf(room);
              const active = room.id === selectedId;
              const hit = highlightIds?.has(room.id);
              const dimmed = mode === 'view' && selected && !active && selected.parentId !== room.id;
              return (
                <path
                  key={room.id}
                  d={pathOf(shape)}
                  role="button"
                  tabIndex={0}
                  aria-label={room.name}
                  aria-pressed={active}
                  data-map-room={room.id}
                  data-hit={hit ? 'true' : undefined}
                  onKeyDown={(event) => keySelect(event, room.id)}
                  onPointerDown={(event) => pressItem(event, room)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(room.id);
                  }}
                  onDoubleClick={(event) => {
                    if (mode !== 'edit-full' || !active || shape.type !== 'polygon') return;
                    event.stopPropagation();
                    const point = viewport.toMap(event.clientX, event.clientY).map(Math.round) as MapPoint;
                    const index = nearestEdge(shape.points, point);
                    const points = [...shape.points];
                    points.splice(index + 1, 0, point);
                    onShapesChange?.([{ id: room.id, shape: { type: 'polygon', points } }]);
                  }}
                  style={{ fill: `var(--map-room-${(roomIndex.get(room.id) ?? 0) % 6})`, fillOpacity: editing && background ? 0.6 : 1, opacity: dimmed ? 0.45 : 1 }}
                  className={
                    'outline-none transition-opacity duration-200 ' +
                    (active || hit ? 'stroke-accent ' : 'stroke-[var(--map-stroke)] ') +
                    (hit ? 'map-hit ' : '') +
                    (editing && active ? 'cursor-move' : 'cursor-pointer')
                  }
                  strokeWidth={(active || hit ? 2.5 : 1) * unit}
                  strokeLinejoin="round"
                />
              );
            })}
            <MapInner inner={inner} shapeOf={shapeOf} selectedId={selectedId} highlightIds={highlightIds} editing={editing} unit={unit}
              onPress={pressItem} onSelect={onSelect} onKey={keySelect} />
            <MapLabels rooms={rooms} inner={inner} shapeOf={shapeOf} scale={scale} />
            {/* 电脑上房间顶点、柜子四角都能拉；手机上只拉柜子 / 家具（房间形状限电脑，v2 拍板 1） */}
            {selected && selectedShape && (mode === 'edit-full' || (mode === 'edit-containers' && selected.kind !== 'room')) ? (
              <MapHandles
                item={selected}
                shape={selectedShape}
                size={handleSize(selectedShape, scale, coarse) * unit}
                unit={unit}
                selectedVertex={selectedVertex}
                onVertexDown={(event, index) =>
                  selectedShape.type === 'polygon' &&
                  begin(event, {
                    type: 'vertex',
                    id: selected.id,
                    index,
                    shape: selectedShape,
                    neighbours: rooms.filter((one) => one.id !== selected.id).map((one) => shapePoints(shapeOf(one))),
                    origin: viewport.toMap(event.clientX, event.clientY),
                    started: false,
                  })
                }
                onVertexDelete={(index) => {
                  if (selectedShape.type !== 'polygon') return;
                  if (selectedShape.points.length <= 3) {
                    onHint?.('房间至少要 3 个顶点');
                    return;
                  }
                  onShapesChange?.([{ id: selected.id, shape: { type: 'polygon', points: selectedShape.points.filter((_, i) => i !== index) } }]);
                }}
                onResizeDown={(event, corner) => {
                  const parent = selected.parentId ? byId.get(selected.parentId) : null;
                  if (selectedShape.type === 'rect') {
                    begin(event, {
                      type: 'resize',
                      id: selected.id,
                      corner,
                      shape: selectedShape,
                      clamp: parent ? shapeBounds(shapeOf(parent)) : null,
                      siblings: siblingBounds(selected),
                    });
                  }
                }}
              />
            ) : null}
            {guides.map(([a, b], index) => (
              <line key={index} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} data-map-guide
                className="pointer-events-none stroke-warm" strokeWidth={1.8 * unit} strokeDasharray={`${6 * unit} ${4 * unit}`} />
            ))}
            <MapDrawOverlay ghost={ghost} drawing={drawing} straighten={snap} unit={unit} />
          </g>
        </svg>
      ) : null}
      {floating && viewport.view
        ? floating({
            toScreen: (b) => {
              const v = viewport.view;
              if (!v) return null;
              return { left: v.x + b.minX * v.scale, top: v.y + b.minY * v.scale, right: v.x + b.maxX * v.scale, bottom: v.y + b.maxY * v.scale };
            },
            size: viewport.size,
            moving: viewport.panning || dragging,
          })
        : null}
      {overlay}
    </div>
  );
});
