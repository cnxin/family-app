import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { MapRect, MapShape } from '@family/contracts';
import { clampRect, pointInShape, shapeBounds, shapePoints, type MapBounds, type MapPoint } from '@family/shared';
import { MapHandles, MapLabels } from './map-layers';
import type { MapItem, MapMode, MapTool, ShapeChange } from './map-types';
import { useMapViewport } from './use-map-viewport';

// 家庭地图画布（item-location-plan §3 I2b）：SVG 自写，不引画布库。
// 看：点房间、点柜子、命中高亮；编辑：拖顶点、双击边加顶点、右键删顶点、拖房间（里面的柜子跟着走）、
// 拖 / 缩放柜子、拖一个矩形画新房间或柜子。拖动时只在本地预览，松手才交给上层（上层防抖保存）。

const DRAG_SLOP = 4;
const MIN_DRAW = 12;

type Drag =
  | { type: 'vertex'; id: string; index: number; shape: Extract<MapShape, { type: 'polygon' }> }
  | { type: 'move'; ids: string[]; origin: MapPoint; shapes: Map<string, MapShape>; clamp: MapBounds | null; started: boolean }
  | { type: 'resize'; id: string; corner: 'nw' | 'se'; shape: MapRect; clamp: MapBounds | null }
  | { type: 'draw'; kind: 'room' | 'container'; parentId: string | null; start: MapPoint; end: MapPoint };

export interface MapCanvasHandle {
  focus: (bounds: MapBounds, maxZoom?: number, inset?: { right?: number; bottom?: number }) => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
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
  /** 顶点编辑之外的提示（比如「柜子要画在房间里」） */
  onHint?: (message: string) => void;
  /** 盖在画布上的按钮（缩放、工具条） */
  overlay?: ReactNode;
  label: string;
}

function translate(shape: MapShape, dx: number, dy: number): MapShape {
  if (shape.type === 'rect') return { ...shape, x: Math.round(shape.x + dx), y: Math.round(shape.y + dy) };
  return { type: 'polygon', points: shape.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as MapPoint) };
}

function pathOf(shape: MapShape) {
  return `M${shapePoints(shape).map(([x, y]) => `${x},${y}`).join('L')}Z`;
}

function nearestEdge(points: MapPoint[], [px, py]: MapPoint) {
  let best = { index: 0, distance: Infinity };
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (distance < best.distance) best = { index: i, distance };
  });
  return best.index;
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { viewBox, items, background, backgroundOpacity = 1, mode, tool = 'select', selectedId, highlightIds, onSelect, onShapesChange, onDraw, onHint, overlay, label },
  ref,
) {
  const viewport = useMapViewport(viewBox);
  // 本地预览只对当时那份 items 有效：上层数据一变（保存回来、别处改了）预览自动作废。上层要 useMemo 住 items。
  const [preview, setPreviewState] = useState<{ base: MapItem[]; shapes: Map<string, MapShape> }>({ base: items, shapes: new Map() });
  const [drawing, setDrawing] = useState<{ start: MapPoint; end: MapPoint } | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef<Map<string, MapShape>>(new Map());
  const suppress = useRef(false);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, []);

  useImperativeHandle(ref, () => ({ focus: viewport.focus, reset: viewport.reset, zoomBy: (factor: number) => void viewport.zoomBy(factor) }), [viewport]);

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
    const [mx, my] = viewport.toMap(event.clientX, event.clientY);
    const x = Math.round(Math.min(viewBox.w, Math.max(0, mx)));
    const y = Math.round(Math.min(viewBox.h, Math.max(0, my)));
    if (d.type === 'draw') {
      d.end = [x, y];
      setDrawing({ start: d.start, end: d.end });
      return;
    }
    if (d.type === 'vertex') {
      const points = d.shape.points.map((p, i) => (i === d.index ? ([x, y] as MapPoint) : p));
      setPreview(new Map([[d.id, { type: 'polygon', points }]]));
      return;
    }
    if (d.type === 'resize') {
      const r = d.shape;
      let x1 = r.x;
      let y1 = r.y;
      let x2 = r.x + r.w;
      let y2 = r.y + r.h;
      if (d.corner === 'nw') [x1, y1] = [Math.min(x, x2 - 4), Math.min(y, y2 - 4)];
      else [x2, y2] = [Math.max(x, x1 + 4), Math.max(y, y1 + 4)];
      const next = { type: 'rect' as const, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      setPreview(new Map([[d.id, d.clamp ? clampRect(next, d.clamp) : next]]));
      return;
    }
    let dx = mx - d.origin[0];
    let dy = my - d.origin[1];
    if (!d.started && Math.hypot(dx, dy) * scale < DRAG_SLOP) return;
    d.started = true;
    const lead = d.shapes.get(d.ids[0])!;
    if (d.clamp && lead.type === 'rect') {
      const moved = clampRect({ ...lead, x: lead.x + dx, y: lead.y + dy }, d.clamp);
      dx = moved.x - lead.x;
      dy = moved.y - lead.y;
    } else {
      const b = shapeBounds(lead);
      dx = Math.min(viewBox.w - b.maxX, Math.max(-b.minX, dx));
      dy = Math.min(viewBox.h - b.maxY, Math.max(-b.minY, dy));
    }
    setPreview(new Map(d.ids.map((id) => [id, translate(d.shapes.get(id)!, dx, dy)])));
  };

  const finish = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // 这一下松手之后浏览器还会补一个 click，别让它再去选中 / 取消选中
    suppress.current = d.type !== 'move' || d.started;
    if (d.type === 'draw') {
      setDrawing(null);
      const rect = {
        type: 'rect' as const,
        x: Math.min(d.start[0], d.end[0]),
        y: Math.min(d.start[1], d.end[1]),
        w: Math.abs(d.end[0] - d.start[0]),
        h: Math.abs(d.end[1] - d.start[1]),
      };
      if (rect.w * scale < MIN_DRAW || rect.h * scale < MIN_DRAW) return;
      const parent = d.parentId ? byId.get(d.parentId) : null;
      onDraw?.(d.kind, parent ? clampRect(rect, shapeBounds(shapeOf(parent))) : rect, d.parentId);
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
    const start = viewport.toMap(event.clientX, event.clientY).map((v) => Math.round(v)) as MapPoint;
    let parentId: string | null = null;
    if (tool === 'container') {
      const room = roomAt(start);
      if (!room) {
        onHint?.('柜子要画在房间里：从房间里面开始拖');
        return true;
      }
      parentId = room.id;
    }
    begin(event, { type: 'draw', kind: tool, parentId, start, end: start });
    setDrawing({ start, end: start });
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
            {inner.map((item) => {
              const shape = shapeOf(item);
              const active = item.id === selectedId;
              const hit = highlightIds?.has(item.id);
              const container = item.kind === 'container';
              return (
                <path
                  key={item.id}
                  d={pathOf(shape)}
                  role="button"
                  tabIndex={0}
                  aria-label={item.name}
                  aria-pressed={active}
                  data-map-container={item.id}
                  data-hit={hit ? 'true' : undefined}
                  onKeyDown={(event) => keySelect(event, item.id)}
                  onPointerDown={(event) => pressItem(event, item)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(item.id);
                  }}
                  className={
                    'outline-none ' +
                    (hit ? 'fill-warm-soft stroke-warm map-hit ' : active ? 'fill-accent-soft stroke-accent ' : container ? 'fill-surface stroke-[var(--map-stroke)] ' : 'fill-transparent stroke-[var(--map-stroke)] ') +
                    (editing ? 'cursor-move' : 'cursor-pointer')
                  }
                  fillOpacity={container || hit || active ? 0.92 : 0}
                  strokeWidth={(active || hit ? 2.5 : 1) * unit}
                  strokeDasharray={container ? undefined : `${4 * unit} ${3 * unit}`}
                  rx={3 * unit}
                />
              );
            })}
            <MapLabels rooms={rooms} inner={inner} shapeOf={shapeOf} scale={scale} />
            {mode === 'edit-full' && selected && selectedShape ? (
              <MapHandles
                item={selected}
                shape={selectedShape}
                size={(coarse ? 11 : 6) * unit}
                unit={unit}
                onVertexDown={(event, index) =>
                  selectedShape.type === 'polygon' && begin(event, { type: 'vertex', id: selected.id, index, shape: selectedShape })
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
                    begin(event, { type: 'resize', id: selected.id, corner, shape: selectedShape, clamp: parent ? shapeBounds(shapeOf(parent)) : null });
                  }
                }}
              />
            ) : null}
            {drawing ? (
              <rect
                x={Math.min(drawing.start[0], drawing.end[0])}
                y={Math.min(drawing.start[1], drawing.end[1])}
                width={Math.abs(drawing.end[0] - drawing.start[0])}
                height={Math.abs(drawing.end[1] - drawing.start[1])}
                className="pointer-events-none fill-accent-soft stroke-accent"
                fillOpacity={0.5}
                strokeWidth={2 * unit}
                strokeDasharray={`${6 * unit} ${4 * unit}`}
              />
            ) : null}
          </g>
        </svg>
      ) : null}
      {overlay}
    </div>
  );
});
