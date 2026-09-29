// 家庭地图的平面几何（item-location-plan §2.2）：API 校验形状、客户端编辑器和房间识别共用。
// 坐标都在地图 viewBox 里（宽 1000），整数；房间多边形可凹，柜子是轴对齐矩形。

export type MapPoint = [number, number];
export type MapGeometryShape =
  | { type: 'polygon'; points: MapPoint[] }
  | { type: 'rect'; x: number; y: number; w: number; h: number };
export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function shapePoints(shape: MapGeometryShape): MapPoint[] {
  if (shape.type === 'polygon') return shape.points;
  return [
    [shape.x, shape.y],
    [shape.x + shape.w, shape.y],
    [shape.x + shape.w, shape.y + shape.h],
    [shape.x, shape.y + shape.h],
  ];
}

export function shapeBounds(shape: MapGeometryShape): MapBounds {
  const points = shapePoints(shape);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function polygonArea(points: MapPoint[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** 射线法；正好压在边上的点算在里面。 */
export function pointInShape([px, py]: MapPoint, shape: MapGeometryShape) {
  const points = shapePoints(shape);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const cross = (px - xi) * (yj - yi) - (py - yi) * (xj - xi);
    const onSegment =
      cross === 0 && px >= Math.min(xi, xj) && px <= Math.max(xi, xj) && py >= Math.min(yi, yj) && py <= Math.max(yi, yj);
    if (onSegment) return true;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance([px, py]: MapPoint, [ax, ay]: MapPoint, [bx, by]: MapPoint) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function boxDistance([px, py]: MapPoint, box: MapBounds) {
  const dx = Math.max(box.minX - px, 0, px - box.maxX);
  const dy = Math.max(box.minY - py, 0, py - box.maxY);
  return Math.hypot(dx, dy);
}

/**
 * 房名放哪：离边最远的内部点（近似「不可达极点」，网格粗搜再细搜）。
 * L 形、凹形房间的外接框中心可能落在房间外，名字会写到别的房间里去。
 * avoid：房间里画了的柜子，名字尽量别压在它们上面。
 */
export function labelPoint(shape: MapGeometryShape, avoid: MapBounds[] = []): MapPoint {
  const points = shapePoints(shape);
  const bounds = shapeBounds(shape);
  const edgeDistance = (p: MapPoint) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i += 1) best = Math.min(best, segmentDistance(p, points[i], points[(i + 1) % points.length]));
    for (const box of avoid) best = Math.min(best, boxDistance(p, box));
    return best;
  };
  let best: MapPoint = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  let bestScore = pointInShape(best, shape) ? edgeDistance(best) : -1;
  let step = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 16;
  let center = best;
  for (let round = 0; round < 3 && step >= 0.5; round += 1) {
    const [cx, cy] = round === 0 ? [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] : center;
    for (let gx = -8; gx <= 8; gx += 1) {
      for (let gy = -8; gy <= 8; gy += 1) {
        const p: MapPoint = [cx + gx * step, cy + gy * step];
        if (!pointInShape(p, shape)) continue;
        const score = edgeDistance(p);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    center = best;
    step /= 8;
  }
  return [Math.round(best[0]), Math.round(best[1])];
}

/** 把矩形挪 / 缩进外框里（柜子不能画到房间外）；外框比矩形还小时缩到外框大小。 */
export function clampRect(rect: { x: number; y: number; w: number; h: number }, bounds: MapBounds) {
  const w = Math.max(1, Math.min(rect.w, bounds.maxX - bounds.minX));
  const h = Math.max(1, Math.min(rect.h, bounds.maxY - bounds.minY));
  const x = Math.min(Math.max(rect.x, bounds.minX), bounds.maxX - w);
  const y = Math.min(Math.max(rect.y, bounds.minY), bounds.maxY - h);
  return { type: 'rect' as const, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** 两个多边形有没有共用的一段边（误差 tolerance 以内）：识别草稿「合并到相邻房间」用。 */
export function shapesTouch(a: MapGeometryShape, b: MapGeometryShape, tolerance: number) {
  const ba = shapeBounds(a);
  const bb = shapeBounds(b);
  if (ba.minX > bb.maxX + tolerance || bb.minX > ba.maxX + tolerance) return false;
  if (ba.minY > bb.maxY + tolerance || bb.minY > ba.maxY + tolerance) return false;
  const pa = shapePoints(a);
  const pb = shapePoints(b);
  const near = (points: MapPoint[], other: MapPoint[]) =>
    points.some((p) => other.some((q, i) => segmentDistance(p, q, other[(i + 1) % other.length]) <= tolerance));
  return near(pa, pb) || near(pb, pa);
}
