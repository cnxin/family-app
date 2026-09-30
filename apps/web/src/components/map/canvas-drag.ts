import type { MapRect, MapShape } from '@family/contracts';
import { clampRect, shapeBounds, shapePoints, snapRect, snapVertex, type MapBounds, type MapPoint, type MapSegment } from '@family/shared';

// 画布上拖动的纯计算：拖顶点、拖整块（房间连同里面的柜子）、拉柜子的角、拖矩形画新的。
// 输入指针的地图坐标，输出本地预览的形状和吸附参考线；不碰 React 状态。
// 吸附（地图编辑器 v2 §2.1）：顶点吸相邻房间的顶点 / 边和直角，柜子吸墙和旁边柜子的边，整间房吸相邻房间的外沿；
// 阈值 = 屏幕 8px 换成地图单位；按住 Alt 临时不吸。

export const DRAG_SLOP = 4;
export const SNAP_PX = 8;

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export type Drag =
  | {
      type: 'vertex';
      id: string;
      index: number;
      shape: Extract<MapShape, { type: 'polygon' }>;
      /** 其他房间的顶点（吸附用） */
      neighbours: MapPoint[][];
      origin: MapPoint;
      /** 过了拖动门槛才算拖；没拖就松手 = 点选这个顶点 */
      started: boolean;
    }
  | {
      type: 'move';
      ids: string[];
      origin: MapPoint;
      shapes: Map<string, MapShape>;
      clamp: MapBounds | null;
      /** 柜子：同房间其他柜子；房间：其他房间（都是外接框） */
      siblings: MapBounds[];
      started: boolean;
    }
  | { type: 'resize'; id: string; corner: Corner; shape: MapRect; clamp: MapBounds | null; siblings: MapBounds[] }
  | { type: 'draw'; kind: 'room' | 'container'; parentId: string | null; start: MapPoint; end: MapPoint };

export interface DragFrame {
  shapes: Map<string, MapShape>;
  guides: MapSegment[];
}

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

/** 一条值贴近某条线就贴上（拉柜子的边用） */
function snapValue(value: number, lines: number[], threshold: number) {
  let best: number | null = null;
  for (const line of lines) if (Math.abs(line - value) <= threshold && (best === null || Math.abs(line - value) < Math.abs(best - value))) best = line;
  return best;
}

/**
 * 拖到 point（地图坐标）时的预览：返回新形状表和参考线；'draw' 表示画矩形的终点变了（d.end 已更新）；
 * null 表示还没过拖动门槛。snap = false 时不吸（Alt）。
 */
export function dragStep(
  d: Drag,
  [mx, my]: MapPoint,
  viewBox: { w: number; h: number },
  scale: number,
  snap = true,
): DragFrame | 'draw' | null {
  const x = Math.round(Math.min(viewBox.w, Math.max(0, mx)));
  const y = Math.round(Math.min(viewBox.h, Math.max(0, my)));
  const threshold = SNAP_PX / scale;
  if (d.type === 'draw') {
    d.end = [x, y];
    return 'draw';
  }
  if (d.type === 'vertex') {
    if (!d.started && Math.hypot(mx - d.origin[0], my - d.origin[1]) * scale < DRAG_SLOP) return null;
    d.started = true;
    const points = d.shape.points;
    const prev = points[(d.index - 1 + points.length) % points.length];
    const next = points[(d.index + 1) % points.length];
    const snapped = snap ? snapVertex([x, y], prev, next, d.neighbours, threshold) : { point: [x, y] as MapPoint, guides: [] };
    return {
      shapes: new Map([[d.id, { type: 'polygon', points: points.map((p, i) => (i === d.index ? snapped.point : p)) }]]),
      guides: snapped.guides,
    };
  }
  if (d.type === 'resize') {
    const r = d.shape;
    const lines = d.clamp ? { xs: [d.clamp.minX, d.clamp.maxX], ys: [d.clamp.minY, d.clamp.maxY] } : { xs: [], ys: [] };
    for (const b of d.siblings) {
      lines.xs.push(b.minX, b.maxX);
      lines.ys.push(b.minY, b.maxY);
    }
    const guides: MapSegment[] = [];
    const sx = snap ? snapValue(x, lines.xs, threshold) : null;
    const sy = snap ? snapValue(y, lines.ys, threshold) : null;
    const px = sx ?? x;
    const py = sy ?? y;
    if (sx !== null) guides.push([[sx, d.clamp?.minY ?? 0], [sx, d.clamp?.maxY ?? viewBox.h]]);
    if (sy !== null) guides.push([[d.clamp?.minX ?? 0, sy], [d.clamp?.maxX ?? viewBox.w, sy]]);
    let x1 = r.x;
    let y1 = r.y;
    let x2 = r.x + r.w;
    let y2 = r.y + r.h;
    if (d.corner.includes('w')) x1 = Math.min(px, x2 - 4);
    else x2 = Math.max(px, x1 + 4);
    if (d.corner.includes('n')) y1 = Math.min(py, y2 - 4);
    else y2 = Math.max(py, y1 + 4);
    const next: MapRect = { ...r, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    return { shapes: new Map([[d.id, d.clamp ? clampRect(next, d.clamp) : next]]), guides };
  }
  let dx = mx - d.origin[0];
  let dy = my - d.origin[1];
  if (!d.started && Math.hypot(dx, dy) * scale < DRAG_SLOP) return null;
  d.started = true;
  const lead = d.shapes.get(d.ids[0])!;
  const b = shapeBounds(lead);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  let guides: MapSegment[] = [];
  if (snap) {
    const room = d.clamp ?? { minX: 0, minY: 0, maxX: viewBox.w, maxY: viewBox.h };
    const snapped = snapRect({ x: b.minX + dx, y: b.minY + dy, w, h }, room, d.siblings, threshold);
    dx = snapped.x - b.minX;
    dy = snapped.y - b.minY;
    guides = snapped.guides;
  }
  if (d.clamp && lead.type === 'rect') {
    const moved = clampRect({ ...lead, x: lead.x + dx, y: lead.y + dy }, d.clamp);
    dx = moved.x - lead.x;
    dy = moved.y - lead.y;
  } else {
    dx = Math.min(viewBox.w - b.maxX, Math.max(-b.minX, dx));
    dy = Math.min(viewBox.h - b.maxY, Math.max(-b.minY, dy));
  }
  return { shapes: new Map(d.ids.map((id) => [id, translate(d.shapes.get(id)!, dx, dy)])), guides };
}

export type { MapBounds };
