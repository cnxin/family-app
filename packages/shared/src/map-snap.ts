// 地图编辑器 v2 §2：改形状省力的纯函数——拖顶点吸到相邻房间的顶点 / 边、吸直角；柜子吸墙；
// 「矩形化」「对齐相邻」。只算坐标，不碰界面；阈值由调用方按屏幕像素换成地图单位传进来。

import { shapeBounds, type MapBounds, type MapGeometryShape, type MapPoint } from './map-geometry';

export type MapSegment = [MapPoint, MapPoint];

export interface SnapResult {
  point: MapPoint;
  /** 吸住时给界面画的参考线（地图坐标） */
  guides: MapSegment[];
}

function project([px, py]: MapPoint, [ax, ay]: MapPoint, [bx, by]: MapPoint) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  const q: MapPoint = [ax + t * dx, ay + t * dy];
  return { point: q, distance: Math.hypot(px - q[0], py - q[1]) };
}

const round = ([x, y]: MapPoint): MapPoint => [Math.round(x), Math.round(y)];

/**
 * 拖房间顶点时的吸附。优先级：相邻房间的顶点 > 相邻房间的边 > 直角（和前后两个顶点对齐成水平 / 竖直）。
 * 吸到边之后仍会试一次直角（沿着那条边滑到和前后点对齐的位置），吸不上就保持在边上。
 */
export function snapVertex(
  point: MapPoint,
  prev: MapPoint,
  next: MapPoint,
  neighbours: MapPoint[][],
  threshold: number,
): SnapResult {
  let best: { point: MapPoint; distance: number; guide: MapSegment } | null = null;
  for (const polygon of neighbours) {
    for (const vertex of polygon) {
      const distance = Math.hypot(point[0] - vertex[0], point[1] - vertex[1]);
      if (distance <= threshold && (!best || distance < best.distance)) best = { point: vertex, distance, guide: [vertex, vertex] };
    }
  }
  if (best) return { point: round(best.point), guides: [best.guide] };

  let edge: { point: MapPoint; distance: number; segment: MapSegment } | null = null;
  for (const polygon of neighbours) {
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const hit = project(point, a, b);
      if (hit.distance <= threshold && (!edge || hit.distance < edge.distance)) edge = { ...hit, segment: [a, b] };
    }
  }
  let [x, y] = edge ? edge.point : point;
  const guides: MapSegment[] = edge ? [edge.segment] : [];
  const horizontalEdge = Boolean(edge && Math.abs(edge.segment[0][1] - edge.segment[1][1]) < 1);
  const verticalEdge = Boolean(edge && Math.abs(edge.segment[0][0] - edge.segment[1][0]) < 1);
  // 直角：x 对齐前 / 后点 → 竖直边；y 对齐 → 水平边。吸在竖直墙上 x 已定、只能沿墙改 y；水平墙上只能改 x
  for (const other of [prev, next]) {
    if (!verticalEdge && Math.abs(x - other[0]) <= threshold) {
      x = other[0];
      guides.push([[x, Math.min(y, other[1])], [x, Math.max(y, other[1])]]);
      break;
    }
  }
  for (const other of [prev, next]) {
    if (!horizontalEdge && Math.abs(y - other[1]) <= threshold) {
      y = other[1];
      guides.push([[Math.min(x, other[0]), y], [Math.max(x, other[0]), y]]);
      break;
    }
  }
  return { point: round([x, y]), guides };
}

/**
 * 柜子（轴对齐矩形）挪动时的吸附：左右 / 上下边贴到房间墙（外接框）或同房间其他柜子的边上。
 * 返回修正后的左上角和参考线。
 */
export function snapRect(
  rect: { x: number; y: number; w: number; h: number },
  room: MapBounds,
  siblings: MapBounds[],
  threshold: number,
): { x: number; y: number; guides: MapSegment[] } {
  const xs = [room.minX, room.maxX, ...siblings.flatMap((b) => [b.minX, b.maxX])];
  const ys = [room.minY, room.maxY, ...siblings.flatMap((b) => [b.minY, b.maxY])];
  const guides: MapSegment[] = [];
  const pick = (values: number[], edges: number[]) => {
    let best: { offset: number; line: number } | null = null;
    for (const line of values) {
      for (const edge of edges) {
        const offset = line - edge;
        if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, line };
      }
    }
    return best;
  };
  const sx = pick(xs, [rect.x, rect.x + rect.w]);
  const sy = pick(ys, [rect.y, rect.y + rect.h]);
  const x = Math.round(rect.x + (sx?.offset ?? 0));
  const y = Math.round(rect.y + (sy?.offset ?? 0));
  if (sx) guides.push([[sx.line, Math.min(room.minY, y)], [sx.line, Math.max(room.maxY, y + rect.h)]]);
  if (sy) guides.push([[Math.min(room.minX, x), sy.line], [Math.max(room.maxX, x + rect.w), sy.line]]);
  return { x, y, guides };
}

/** 矩形化：换成外接矩形（4 个顶点，顺时针） */
export function rectangularize(shape: MapGeometryShape): MapPoint[] {
  const b = shapeBounds(shape);
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
}

const orientation = (a: MapPoint, b: MapPoint, tolerance = Math.tan((7 * Math.PI) / 180)) => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dy <= dx * tolerance) return 'h' as const;
  if (dx <= dy * tolerance) return 'v' as const;
  return null;
};

/**
 * 对齐相邻：选中房间的每条近乎水平 / 竖直的边，若相邻房间有同向、距离 ≤ maxGap、投影有重叠的边，
 * 就把这条边挪到那条边的线上（只动选中的这间）。返回新顶点和挪了几条边。
 */
export function alignToNeighbours(points: MapPoint[], neighbours: MapPoint[][], maxGap: number): { points: MapPoint[]; moved: number } {
  const out = points.map((p) => [...p] as MapPoint);
  let moved = 0;
  points.forEach((a, i) => {
    const j = (i + 1) % points.length;
    const b = points[j];
    const kind = orientation(a, b);
    if (!kind) return;
    const axis = kind === 'h' ? 1 : 0;
    const along = kind === 'h' ? 0 : 1;
    const level = (a[axis] + b[axis]) / 2;
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    let best: { line: number; gap: number } | null = null;
    for (const polygon of neighbours) {
      for (let k = 0; k < polygon.length; k += 1) {
        const c = polygon[k];
        const d = polygon[(k + 1) % polygon.length];
        if (orientation(c, d) !== kind) continue;
        const line = (c[axis] + d[axis]) / 2;
        const gap = Math.abs(line - level);
        const overlap = Math.min(hi, Math.max(c[along], d[along])) - Math.max(lo, Math.min(c[along], d[along]));
        if (gap > 0 && gap <= maxGap && overlap > 0 && (!best || gap < best.gap)) best = { line, gap };
      }
    }
    if (!best) return;
    out[i][axis] = Math.round(best.line);
    out[j][axis] = Math.round(best.line);
    moved += 1;
  });
  return { points: out, moved };
}
