// 扫地机地图 → 房间多边形草稿（item-location-plan §3 I2a 第 2 步）。纯函数，只吃 RGBA 像素，
// 浏览器里在 Worker 跑（detect-rooms.worker.ts），单测在 node 里直接喂解码后的样图。
//
// 流程：缩到工作分辨率 → 挑出「有颜色」的像素（白底、灰墙、灰色未清扫区、深色文字图标都不算房间）→
// 按颜色聚成 ≤ 8 簇 → 每簇：小半径闭运算（补网格线缝，不跨墙）→ 填洞（沙发、床、房名图标）→
// 连通域拆开（同色不相邻的是不同房间）→ 丢掉太小的 → 描外轮廓 → Douglas–Peucker → 直角化、并掉短边。
// 输出坐标在地图 viewBox 里（宽 1000）。

import { components, dilate, erode, fillHoles } from './morphology';
import { orthogonalize, polygonArea, simplifyClosed, traceOutline } from './outline';

export interface DetectInput {
  width: number;
  height: number;
  /** RGBA，长度 width × height × 4 */
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectedRoom {
  points: [number, number][];
  /** 占整张（裁剪后）图的面积比例 */
  share: number;
  /** 这块的颜色（#rrggbb），调试和草稿着色用 */
  color: string;
}

export interface DetectResult {
  rooms: DetectedRoom[];
  viewBox: { w: number; h: number };
  /** 工作分辨率 */
  work: { w: number; h: number };
  ms: number;
}

const WORK_WIDTH = 640;
const MAX_CLUSTERS = 8;
/** 至少这么「有颜色」才算房间（RGB 最大减最小，0～255） */
const MIN_CHROMA = 38;
/** 面积小于整图这么多的连通域当噪点丢掉 */
const MIN_SHARE = 0.003;
/** 抹平家具缺口的闭运算半径（工作图宽的比例） */
const SMOOTH_SHARE = 0.03;
const MAX_SMOOTH_SHARE = 0.09;
/** 截图里墙线大约是图宽的 0.6%～0.8%，房间往外长半个墙厚 */
const WALL_HALF_SHARE = 0.0035;
/** 顶点超过这么多就加大闭运算半径再描一次 */
const VERTEX_BUDGET = 12;
const VERTEX_LIMIT = 16;


function downscale(input: DetectInput) {
  const scale = Math.min(1, WORK_WIDTH / input.width);
  const w = Math.max(1, Math.round(input.width * scale));
  const h = Math.max(1, Math.round(input.height * scale));
  const out = new Uint8ClampedArray(w * h * 3);
  // 取块内中位附近的一个采样点（最近邻）：面积平均会把灰墙和房间色混成新颜色
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(input.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(input.width - 1, Math.floor((x + 0.5) / scale));
      const i = (sy * input.width + sx) * 4;
      const o = (y * w + x) * 3;
      out[o] = input.data[i];
      out[o + 1] = input.data[i + 1];
      out[o + 2] = input.data[i + 2];
    }
  }
  return { w, h, rgb: out };
}

/**
 * 有颜色的像素按颜色聚类：最远点法取种子（先取最常见的颜色，再依次取离已有种子最远的），再 k-means 几轮，
 * 最后把很近的簇并掉。最远点法保证少数色（黄色的卫生间、厨房）有自己的种子，不被大片橙色吞掉。
 */
function cluster(rgb: Uint8ClampedArray, colored: Uint8Array) {
  const counts = new Map<number, { n: number; sum: [number, number, number] }>();
  for (let i = 0; i < colored.length; i += 1) {
    if (!colored[i]) continue;
    // 每通道 16 级粗量化后计数，当作带权样本
    const key = ((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4);
    const bucket = counts.get(key) ?? { n: 0, sum: [0, 0, 0] };
    bucket.n += 1;
    bucket.sum[0] += rgb[i * 3];
    bucket.sum[1] += rgb[i * 3 + 1];
    bucket.sum[2] += rgb[i * 3 + 2];
    counts.set(key, bucket);
  }
  const total = [...counts.values()].reduce((n, b) => n + b.n, 0);
  // 占比太小的颜色（抗锯齿过渡色、图标）不当种子
  const samples = [...counts.values()]
    .filter((b) => b.n >= total * 0.002)
    .map((b) => ({ c: b.sum.map((v) => v / b.n), n: b.n }))
    .sort((a, b) => b.n - a.n);
  if (!samples.length) return [];
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let centers: number[][] = [samples[0].c];
  while (centers.length < MAX_CLUSTERS) {
    let best = null as null | { c: number[]; d: number };
    for (const s of samples) {
      const d = Math.min(...centers.map((c) => distance(s.c, c)));
      if (!best || d > best.d) best = { c: s.c, d };
    }
    if (!best || best.d < 36) break;
    centers.push(best.c);
  }
  for (let round = 0; round < 10; round += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let k = 0;
      centers.forEach((c, j) => {
        if (distance(s.c, c) < distance(s.c, centers[k])) k = j;
      });
      sums[k][0] += s.c[0] * s.n;
      sums[k][1] += s.c[1] * s.n;
      sums[k][2] += s.c[2] * s.n;
      sums[k][3] += s.n;
    }
    centers = sums.filter((s) => s[3] > 0).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  const merged: number[][] = [];
  for (const c of centers) if (!merged.some((m) => distance(m, c) < 30)) merged.push(c);
  return merged;
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function detectRooms(input: DetectInput, now: () => number = () => Date.now()): DetectResult {
  const started = now();
  const { w, h, rgb } = downscale(input);
  const viewBox = { w: 1000, h: Math.max(100, Math.min(4000, Math.round((1000 * input.height) / input.width))) };
  const colored = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    // 太暗的（房名文字、图标、墙线）不算，哪怕带点颜色
    colored[i] = chroma >= MIN_CHROMA && Math.max(r, g, b) > 110 ? 1 : 0;
  }
  const centers = cluster(rgb, colored);
  const assign = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i += 1) {
    if (!colored[i]) continue;
    let best = -1;
    let bestD = Infinity;
    centers.forEach((c, k) => {
      const d = (rgb[i * 3] - c[0]) ** 2 + (rgb[i * 3 + 1] - c[1]) ** 2 + (rgb[i * 3 + 2] - c[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    assign[i] = best;
  }
  const closeRadius = Math.max(1, Math.round(w * 0.003));
  const minPixels = w * h * MIN_SHARE;
  const toView = (value: number, axis: 'x' | 'y') =>
    Math.round(Math.min(axis === 'x' ? viewBox.w : viewBox.h, Math.max(0, (value / (axis === 'x' ? w : h)) * (axis === 'x' ? viewBox.w : viewBox.h))));
  const rooms: DetectedRoom[] = [];
  // 先按颜色拆出所有房间块（小闭运算补网格缝、填洞、连通域），再逐块做大半径闭运算抹平家具缺口
  const blocks: { pixels: number[]; color: number[] }[] = [];
  const owner = new Int32Array(w * h).fill(-1);
  centers.forEach((center, k) => {
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) if (assign[i] === k) mask[i] = 1;
    mask = erode(dilate(mask, w, h, closeRadius), w, h, closeRadius);
    mask = fillHoles(mask, w, h);
    for (const pixels of components(mask, w)) {
      if (pixels.length < minPixels) continue;
      for (const i of pixels) owner[i] = blocks.length;
      blocks.push({ pixels, color: center });
    }
  });
  const baseSmooth = Math.max(2, Math.round(w * SMOOTH_SHARE));
  const wallHalf = Math.max(1, Math.round(w * WALL_HALF_SHARE));
  blocks.forEach((block, index) => {
    // 只在这块的外接框（外扩一圈）里算，11 个房间 × 整张图太慢
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (const i of block.pixels) {
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = Math.round(w * MAX_SMOOTH_SHARE) * 2 + 2;
    const ox = Math.max(0, minX - pad);
    const oy = Math.max(0, minY - pad);
    const bw = Math.min(w, maxX + pad + 1) - ox;
    const bh = Math.min(h, maxY + pad + 1) - oy;
    const local = new Uint8Array(bw * bh);
    const foreign = new Uint8Array(bw * bh);
    for (const i of block.pixels) local[((i - (i % w)) / w - oy) * bw + (i % w) - ox] = 1;
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const o = owner[(y + oy) * w + x + ox];
        if (o >= 0 && o !== index) foreign[y * bw + x] = 1;
      }
    }
    // 靠墙的床、沙发、没扫到的角落在截图上是和外面连着的白块，填洞填不上；闭运算把窄于 2×半径的缺口补平，
    // 补出来的部分不许压到别的房间上。顶点超过预算就加大半径再来（目标 4～12，上限 16）。
    let best: [number, number][] | null = null;
    for (let smooth = baseSmooth; smooth <= Math.round(w * MAX_SMOOTH_SHARE); smooth = Math.ceil(smooth * 1.4)) {
      // 腐蚀比膨胀少半个墙厚：色块只到墙边，房间的边界在墙中线，相邻房间正好贴上
      let mask = fillHoles(erode(dilate(local, bw, bh, smooth), bw, bh, smooth - wallHalf), bw, bh);
      for (let i = 0; i < mask.length; i += 1) if (foreign[i]) mask[i] = 0;
      const part = components(mask, bw).sort((a, b) => b.length - a.length)[0];
      if (!part || part.length < minPixels) break;
      const outline = traceOutline(part, bw).map(([x, y]) => [x + ox, y + oy] as [number, number]);
      // 半径到头还超上限：放大简化容差（0.8% → 最多 2.4%）
      for (let tolerance = 0.008; tolerance <= 0.024; tolerance += 0.004) {
        const simplified = simplifyClosed(outline, Math.max(1, w * tolerance));
        let polygon = orthogonalize(simplified, Math.max(2, w * 0.015));
        if (polygon.length < 3) polygon = simplified;
        if (!best || polygon.length < best.length || tolerance === 0.008) best = polygon;
        if (polygon.length <= VERTEX_LIMIT || smooth * 1.4 <= w * MAX_SMOOTH_SHARE) break;
      }
      if (best && best.length <= VERTEX_BUDGET) break;
      mask = new Uint8Array(0);
    }
    if (!best) return;
    const points = best.map(([x, y]) => [toView(x, 'x'), toView(y, 'y')] as [number, number]);
    const area = polygonArea(points);
    if (points.length < 3 || area < 1) return;
    rooms.push({ points, share: area / (viewBox.w * viewBox.h), color: hex(block.color) });
  });
  // 从上到下、从左到右排，命名时顺着看
  rooms.sort((a, b) => {
    const ay = Math.min(...a.points.map((p) => p[1]));
    const by = Math.min(...b.points.map((p) => p[1]));
    return Math.abs(ay - by) > 30 ? ay - by : Math.min(...a.points.map((p) => p[0])) - Math.min(...b.points.map((p) => p[0]));
  });
  return { rooms, viewBox, work: { w, h }, ms: now() - started };
}

/**
 * 建议的裁剪框（原图像素）：有颜色的大块（房间）的外接框。App 的按钮、图例、文字是白 / 灰 / 黑，
 * 零星的彩色小图标（充电座、机器人）面积太小不算。四周留 0.5%。导入向导第 1 步默认用它，人再拖。
 */
export function suggestCrop(input: DetectInput) {
  const { w, h, rgb } = downscale(input);
  const colored = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    colored[i] = Math.max(r, g, b) - Math.min(r, g, b) >= MIN_CHROMA && Math.max(r, g, b) > 110 ? 1 : 0;
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (const pixels of components(colored, w)) {
    if (pixels.length < w * h * MIN_SHARE) continue;
    for (const i of pixels) {
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: input.width, h: input.height };
  const scale = input.width / w;
  const pad = Math.round(input.width * 0.005);
  const x = Math.max(0, Math.floor(minX * scale) - pad);
  const y = Math.max(0, Math.floor(minY * scale) - pad);
  return {
    x,
    y,
    w: Math.min(input.width, Math.ceil((maxX + 1) * scale) + pad) - x,
    h: Math.min(input.height, Math.ceil((maxY + 1) * scale) + pad) - y,
  };
}
