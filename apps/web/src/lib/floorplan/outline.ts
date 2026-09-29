// 掩膜 → 多边形：描外轮廓、Douglas–Peucker 简化、直角化（房间识别、草稿合并共用）。

export type Point = [number, number];

/**
 * 外轮廓：沿像素格子的边走（走的是像素角点，得到的就是直角折线），从最上最左的像素开始、顺时针。
 * 连通域是 4 连通且洞已填，外边界是一条闭合折线。
 */
export function traceOutline(pixels: number[], w: number): Point[] {
  const set = new Set(pixels);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && set.has(y * w + x);
  // 不能 Math.min(...pixels)：一个房间十几万像素，展开成参数在浏览器里直接爆栈
  let first = pixels[0];
  for (const i of pixels) if (i < first) first = i;
  const sx = first % w;
  const sy = Math.floor(first / w);
  // 方向：0 右、1 下、2 左、3 上；站在角点 (x, y) 上，右手边是房间
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  let x = sx;
  let y = sy;
  let dir = 0;
  const points: Point[] = [];
  const cellRight = (px: number, py: number, d: number) =>
    // 沿 d 方向走一格时，右手边那个像素
    d === 0 ? inside(px, py) : d === 1 ? inside(px - 1, py) : d === 2 ? inside(px - 1, py - 1) : inside(px, py - 1);
  const cellLeft = (px: number, py: number, d: number) =>
    d === 0 ? inside(px, py - 1) : d === 1 ? inside(px, py) : d === 2 ? inside(px - 1, py) : inside(px - 1, py - 1);
  const limit = pixels.length * 4 + 8;
  for (let guard = 0; guard < limit; guard += 1) {
    // 优先右转，其次直走，再左转
    const right = (dir + 1) % 4;
    const left = (dir + 3) % 4;
    let next = dir;
    if (cellRight(x, y, right) && !cellLeft(x, y, right)) next = right;
    else if (cellRight(x, y, dir) && !cellLeft(x, y, dir)) next = dir;
    else if (cellRight(x, y, left) && !cellLeft(x, y, left)) next = left;
    else next = (dir + 2) % 4;
    if (next !== dir || !points.length) points.push([x, y]);
    dir = next;
    x += dx[dir];
    y += dy[dir];
    if (x === sx && y === sy) break;
  }
  return points;
}

function perpendicular([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
}

/** Douglas–Peucker，用栈不用递归：锯齿轮廓几千个点，递归深度会到几千层 */
function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let index = -1;
    let max = 0;
    for (let i = from + 1; i < to; i += 1) {
      const d = perpendicular(points[i], points[from], points[to]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0 && max > tolerance) {
      keep[index] = 1;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 闭合多边形的 DP：从离起点最远的点切成两段分别简化 */
export function simplifyClosed(points: Point[], tolerance: number) {
  if (points.length <= 4) return points;
  let far = 0;
  let farD = 0;
  points.forEach(([x, y], i) => {
    const d = Math.hypot(x - points[0][0], y - points[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const a = douglasPeucker(points.slice(0, far + 1), tolerance);
  const b = douglasPeucker([...points.slice(far), points[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

type Edge = { kind: 'h' | 'v' | 'd'; a: Point; b: Point; length: number };

/**
 * 直角化：接近水平 / 竖直（±15°）的边吸成水平 / 竖直，相邻同向的边并成一条，短于 minEdge 的边并进邻边，
 * 顶点取相邻两条边所在直线的交点。斜边原样保留。
 */
export function orthogonalize(points: Point[], minEdge: number): Point[] {
  const angleTolerance = Math.tan((15 * Math.PI) / 180);
  let edges: Edge[] = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    const kind = dy <= dx * angleTolerance ? 'h' : dx <= dy * angleTolerance ? 'v' : 'd';
    return { kind, a, b, length: Math.hypot(dx, dy) };
  });
  const level = (edge: Edge) => (edge.kind === 'h' ? (edge.a[1] + edge.b[1]) / 2 : (edge.a[0] + edge.b[0]) / 2);
  const combine = (first: Edge, second: Edge): Edge => {
    const total = first.length + second.length || 1;
    const value = (level(first) * first.length + level(second) * second.length) / total;
    const a: Point = first.kind === 'h' ? [first.a[0], value] : [value, first.a[1]];
    const b: Point = first.kind === 'h' ? [second.b[0], value] : [value, second.b[1]];
    return { kind: first.kind, a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  };
  const mergeSame = (list: Edge[]): Edge[] => {
    const out: Edge[] = [];
    for (const edge of list) {
      const last = out[out.length - 1];
      if (last && last.kind === edge.kind && edge.kind !== 'd') out[out.length - 1] = combine(last, edge);
      else out.push(edge);
    }
    // 首尾也是相邻的
    while (out.length > 1 && out[0].kind === out[out.length - 1].kind && out[0].kind !== 'd') {
      const last = out.pop()!;
      out[0] = combine(last, out[0]);
    }
    return out;
  };
  edges = mergeSame(edges);
  // 短边：去掉，让两侧的边直接相交（小台阶抹平）
  for (let guard = 0; guard < 64 && edges.length > 4; guard += 1) {
    let shortest = -1;
    edges.forEach((edge, i) => {
      if (edge.kind !== 'd' && edge.length < minEdge && (shortest < 0 || edge.length < edges[shortest].length)) shortest = i;
    });
    if (shortest < 0) break;
    edges.splice(shortest, 1);
    edges = mergeSame(edges);
  }
  if (edges.length < 3) return points;
  const out: Point[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const edge = edges[i];
    if (prev.kind === 'h' && edge.kind === 'v') out.push([level(edge), level(prev)]);
    else if (prev.kind === 'v' && edge.kind === 'h') out.push([level(prev), level(edge)]);
    else if (prev.kind === 'h' && edge.kind !== 'v') out.push([edge.a[0], level(prev)]);
    else if (prev.kind === 'v' && edge.kind !== 'h') out.push([level(prev), edge.a[1]]);
    else if (edge.kind === 'h') out.push([prev.b[0], level(edge)]);
    else if (edge.kind === 'v') out.push([level(edge), prev.b[1]]);
    else out.push(edge.a);
  }
  // 去掉重合点和共线点
  const clean: Point[] = [];
  for (const p of out) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) clean.push(p);
  }
  return clean.filter((p, i) => {
    const a = clean[(i - 1 + clean.length) % clean.length];
    const b = clean[(i + 1) % clean.length];
    return perpendicular(p, a, b) > 0.5;
  });
}

export function polygonArea(points: Point[]) {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}
