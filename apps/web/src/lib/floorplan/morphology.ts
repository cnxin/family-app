// 二值掩膜的形态学与连通域（房间识别、草稿合并共用）。都是线性时间，和半径无关。

/** 一行 / 一列上的膨胀：离最近的前景点不超过 r 就算前景。两遍扫描，O(n)，和半径无关 */
function dilateLine(get: (i: number) => number, set: (i: number, v: number) => void, n: number, r: number) {
  const near = new Int32Array(n).fill(1 << 30);
  let last = -(1 << 30);
  for (let i = 0; i < n; i += 1) {
    if (get(i)) last = i;
    near[i] = i - last;
  }
  last = 1 << 30;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (get(i)) last = i;
    set(i, Math.min(near[i], last - i) <= r ? 1 : 0);
  }
}

/** 方形结构元的膨胀：先横后竖，可分离 */
export function dilate(mask: Uint8Array, w: number, h: number, r: number) {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    const base = y * w;
    dilateLine((i) => mask[base + i], (i, v) => (rows[base + i] = v), w, r);
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x += 1) dilateLine((i) => rows[i * w + x], (i, v) => (out[i * w + x] = v), h, r);
  return out;
}

export function erode(mask: Uint8Array, w: number, h: number, r: number) {
  const inverted = mask.map((v) => (v ? 0 : 1));
  // 图边外面当作前景，不然贴边的房间会被从边上腐蚀掉
  return dilate(inverted, w, h, r).map((v) => (v ? 0 : 1));
}

/** 被这块完全包住的洞填上：从图边往里灌「外面」，灌不到的非房间像素就是洞 */
export function fillHoles(mask: Uint8Array, w: number, h: number) {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x += 1) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < mask.length - w) push(i + w);
  }
  return outside.map((v) => (v ? 0 : 1));
}

/** 4 连通分量；返回每块的像素下标 */
export function components(mask: Uint8Array, w: number) {
  const label = new Int32Array(mask.length).fill(-1);
  const out: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = out.length;
    const pixels: number[] = [];
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && mask[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    out.push(pixels);
  }
  return out;
}
