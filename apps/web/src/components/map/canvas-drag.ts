import type { MapRect, MapShape } from '@family/contracts';
import { clampRect, shapeBounds, shapePoints, type MapBounds, type MapPoint } from '@family/shared';

// 画布上拖动的纯计算：拖顶点、拖整块（房间连同里面的柜子）、拉柜子的角、拖矩形画新的。
// 输入指针的地图坐标，输出本地预览的形状；不碰 React 状态，吸附（v2 第 2 笔）也加在这里。

export const DRAG_SLOP = 4;

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export type Drag =
  | { type: 'vertex'; id: string; index: number; shape: Extract<MapShape, { type: 'polygon' }> }
  | { type: 'move'; ids: string[]; origin: MapPoint; shapes: Map<string, MapShape>; clamp: MapBounds | null; started: boolean }
  | { type: 'resize'; id: string; corner: Corner; shape: MapRect; clamp: MapBounds | null }
  | { type: 'draw'; kind: 'room' | 'container'; parentId: string | null; start: MapPoint; end: MapPoint };

export function translate(shape: MapShape, dx: number, dy: number): MapShape {
  if (shape.type === 'rect') return { ...shape, x: Math.round(shape.x + dx), y: Math.round(shape.y + dy) };
  return { type: 'polygon', points: shape.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as MapPoint) };
}

export function pathOf(shape: MapShape) {
  return `M${shapePoints(shape).map(([x, y]) => `${x},${y}`).join('L')}Z`;
}

export function nearestEdge(points: MapPoint[], [px, py]: MapPoint) {
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

/**
 * 拖到 point（地图坐标）时的预览：返回新形状表；'draw' 表示画矩形的终点变了（d.end 已更新）；
 * null 表示还没过拖动门槛。
 */
export function dragStep(d: Drag, [mx, my]: MapPoint, viewBox: { w: number; h: number }, scale: number): Map<string, MapShape> | 'draw' | null {
  const x = Math.round(Math.min(viewBox.w, Math.max(0, mx)));
  const y = Math.round(Math.min(viewBox.h, Math.max(0, my)));
  if (d.type === 'draw') {
    d.end = [x, y];
    return 'draw';
  }
  if (d.type === 'vertex') {
    const points = d.shape.points.map((p, i) => (i === d.index ? ([x, y] as MapPoint) : p));
    return new Map([[d.id, { type: 'polygon', points }]]);
  }
  if (d.type === 'resize') {
    const r = d.shape;
    let x1 = r.x;
    let y1 = r.y;
    let x2 = r.x + r.w;
    let y2 = r.y + r.h;
    if (d.corner.includes('w')) x1 = Math.min(x, x2 - 4);
    else x2 = Math.max(x, x1 + 4);
    if (d.corner.includes('n')) y1 = Math.min(y, y2 - 4);
    else y2 = Math.max(y, y1 + 4);
    const next: MapRect = { ...r, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    return new Map([[d.id, d.clamp ? clampRect(next, d.clamp) : next]]);
  }
  let dx = mx - d.origin[0];
  let dy = my - d.origin[1];
  if (!d.started && Math.hypot(dx, dy) * scale < DRAG_SLOP) return null;
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
  return new Map(d.ids.map((id) => [id, translate(d.shapes.get(id)!, dx, dy)]));
}

export type { MapBounds };
