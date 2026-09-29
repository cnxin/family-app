import { pointInShape, type MapPoint } from '@family/shared';
import { components, dilate, erode, fillHoles } from './morphology';
import { orthogonalize, simplifyClosed, traceOutline } from './outline';

// 识别草稿「并进相邻房间」（item-location-plan §3 I2a 第 3 步）：两块多边形栅格化后取并集，
// 小闭运算补上墙缝，再描轮廓、简化、直角化——和识别同一套，出来的形状风格一致。

const SCALE = 0.5;

export function mergeRooms(a: MapPoint[], b: MapPoint[], viewBox: { w: number; h: number }): MapPoint[] {
  const all = [...a, ...b];
  const pad = 8;
  const minX = Math.max(0, Math.floor(Math.min(...all.map((p) => p[0])) * SCALE) - pad);
  const minY = Math.max(0, Math.floor(Math.min(...all.map((p) => p[1])) * SCALE) - pad);
  const maxX = Math.min(Math.ceil(viewBox.w * SCALE), Math.ceil(Math.max(...all.map((p) => p[0])) * SCALE) + pad);
  const maxY = Math.min(Math.ceil(viewBox.h * SCALE), Math.ceil(Math.max(...all.map((p) => p[1])) * SCALE) + pad);
  const w = maxX - minX;
  const h = maxY - minY;
  const shapes = [a, b].map((points) => ({ type: 'polygon' as const, points }));
  let mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const point: MapPoint = [(x + minX + 0.5) / SCALE, (y + minY + 0.5) / SCALE];
      if (shapes.some((shape) => pointInShape(point, shape))) mask[y * w + x] = 1;
    }
  }
  // 两块之间最多隔着一道墙（识别出来的已经贴到墙中线；手画的可能留几个单位的缝）
  mask = fillHoles(erode(dilate(mask, w, h, 3), w, h, 3), w, h);
  const part = components(mask, w).sort((p, q) => q.length - p.length)[0];
  if (!part) return a;
  const outline = traceOutline(part, w);
  let polygon = orthogonalize(simplifyClosed(outline, 1.5), 3);
  if (polygon.length < 3) polygon = simplifyClosed(outline, 1.5);
  return polygon.map(([x, y]) => [
    Math.round(Math.min(viewBox.w, Math.max(0, (x + minX) / SCALE))),
    Math.round(Math.min(viewBox.h, Math.max(0, (y + minY) / SCALE))),
  ]);
}
