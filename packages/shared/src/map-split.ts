import { polygonArea, type MapPoint } from './map-geometry';

// 地图编辑器 v2 §2.3 拆分房间：用户从墙到墙画一条线，把房间切成两块。
// 线按画的那段（两头各放宽 slack）去和房间边界求交，必须正好交两次；差不多横平竖直的线先拉正（「端点吸直角」）。

const cross = (a: MapPoint, b: MapPoint) => a[0] * b[1] - a[1] * b[0];

/** 接近水平 / 竖直（6° 以内）就拉正：两端取平均 */
export function straightenLine(a: MapPoint, b: MapPoint): [MapPoint, MapPoint] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const tan = Math.tan((6 * Math.PI) / 180);
  if (Math.abs(dy) <= Math.abs(dx) * tan) {
    const y = Math.round((a[1] + b[1]) / 2);
    return [[a[0], y], [b[0], y]];
  }
  if (Math.abs(dx) <= Math.abs(dy) * tan) {
    const x = Math.round((a[0] + b[0]) / 2);
    return [[x, a[1]], [x, b[1]]];
  }
  return [a, b];
}

/**
 * 按线 a→b 把多边形切成两块；交点不是正好两个、或切出来有一块太小（面积 < minArea）就返回 null。
 * slack：线段两头允许差多少（按线长的比例）才碰到墙——手画的线常常差一点没画到墙上。
 */
export function splitPolygon(points: MapPoint[], a: MapPoint, b: MapPoint, slack = 0.25, minArea = 100): [MapPoint[], MapPoint[]] | null {
  const d: MapPoint = [b[0] - a[0], b[1] - a[1]];
  if (Math.hypot(d[0], d[1]) < 1) return null;
  const hits: { edge: number; point: MapPoint }[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    const e: MapPoint = [q[0] - p[0], q[1] - p[1]];
    const denom = cross(d, e);
    if (Math.abs(denom) < 1e-9) return;
    const ap: MapPoint = [p[0] - a[0], p[1] - a[1]];
    const t = cross(ap, e) / denom;
    const u = cross(ap, d) / denom;
    if (u < 0 || u >= 1 || t < -slack || t > 1 + slack) return;
    hits.push({ edge: i, point: [Math.round(p[0] + u * e[0]), Math.round(p[1] + u * e[1])] });
  });
  if (hits.length !== 2 || hits[0].edge === hits[1].edge) return null;
  const [h1, h2] = hits;
  const n = points.length;
  const first: MapPoint[] = [h1.point];
  for (let i = h1.edge + 1; i <= h2.edge; i += 1) first.push(points[i]);
  first.push(h2.point);
  const second: MapPoint[] = [h2.point];
  for (let i = h2.edge + 1; i <= h1.edge + n; i += 1) second.push(points[i % n]);
  second.push(h1.point);
  const clean = (list: MapPoint[]) =>
    list.filter((p, i) => {
      const prev = list[(i - 1 + list.length) % list.length];
      return p[0] !== prev[0] || p[1] !== prev[1];
    });
  const pieces = [clean(first), clean(second)];
  if (pieces.some((piece) => piece.length < 3 || polygonArea(piece) < minArea)) return null;
  return [pieces[0], pieces[1]];
}
