import {
  MAP_STORAGE_FURNITURE,
  type MapDecorFurniture,
  type MapRect,
  type MapShape,
  type MapStorageFurniture,
} from '@family/contracts';
import { pointInShape, shapeBounds, type MapBounds } from '@family/shared';

// 家具库（地图编辑器 v2 §3）：收纳类 10 种（落成带 icon 的柜子，进树、能放东西），装饰类 8 种（只画在图上）。
// 地图没有比例尺，默认尺寸按「viewBox 1 单位 ≈ 1 厘米」估（拍板 5），看模式不显示尺寸数字。

export type FurnitureKey = MapStorageFurniture | MapDecorFurniture;

export interface FurnitureSpec {
  key: FurnitureKey;
  label: string;
  group: 'storage' | 'decor';
  /** 默认宽 × 深（地图单位 ≈ 厘米） */
  w: number;
  h: number;
}

export const FURNITURE: FurnitureSpec[] = [
  { key: 'wardrobe', label: '衣柜', group: 'storage', w: 160, h: 60 },
  { key: 'shoe', label: '鞋柜', group: 'storage', w: 100, h: 35 },
  { key: 'tv', label: '电视柜', group: 'storage', w: 180, h: 40 },
  { key: 'wall', label: '吊柜', group: 'storage', w: 120, h: 35 },
  { key: 'base', label: '地柜', group: 'storage', w: 120, h: 60 },
  { key: 'fridge', label: '冰箱', group: 'storage', w: 70, h: 70 },
  { key: 'bookcase', label: '书柜', group: 'storage', w: 120, h: 35 },
  { key: 'nightstand', label: '床头柜', group: 'storage', w: 45, h: 45 },
  { key: 'shelf', label: '储物架', group: 'storage', w: 100, h: 45 },
  { key: 'drawers', label: '抽屉柜', group: 'storage', w: 80, h: 45 },
  { key: 'sofa', label: '沙发', group: 'decor', w: 200, h: 85 },
  { key: 'bed', label: '床', group: 'decor', w: 180, h: 200 },
  { key: 'dining', label: '餐桌', group: 'decor', w: 140, h: 80 },
  { key: 'desk', label: '书桌', group: 'decor', w: 120, h: 60 },
  { key: 'toilet', label: '马桶', group: 'decor', w: 40, h: 65 },
  { key: 'bathtub', label: '浴缸', group: 'decor', w: 150, h: 75 },
  { key: 'washer', label: '洗衣机', group: 'decor', w: 60, h: 60 },
  { key: 'stove', label: '灶台', group: 'decor', w: 75, h: 45 },
];

const BY_KEY = new Map(FURNITURE.map((one) => [one.key, one]));
export const furnitureSpec = (key: string | null | undefined) => (key ? BY_KEY.get(key as FurnitureKey) ?? null : null);
export const isStorageFurniture = (key: string | null | undefined): key is MapStorageFurniture =>
  (MAP_STORAGE_FURNITURE as readonly string[]).includes(key ?? '');

/**
 * 放在房间中央的默认框：超过房间短边 60% 就等比缩到 60%；中心放不下（L 形、已经摆了别的）就从中心往外一圈圈找空地，
 * 实在没有空地就叠在中央（总比放不下强）。返回 null = 房间本身太小。
 */
export function placementRect(spec: Pick<FurnitureSpec, 'w' | 'h'>, room: MapShape, avoid: MapBounds[] = []): MapRect | null {
  const b = shapeBounds(room);
  const short = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  const factor = Math.min(1, (short * 0.6) / Math.max(spec.w, spec.h));
  const w = Math.max(8, Math.round(spec.w * factor));
  const h = Math.max(8, Math.round(spec.h * factor));
  const inside = (x: number, y: number) =>
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]].every((p) => pointInShape(p as [number, number], room));
  const free = (x: number, y: number) => avoid.every((a) => x + w <= a.minX || x >= a.maxX || y + h <= a.minY || y >= a.maxY);
  const fits = (x: number, y: number) => inside(x, y) && free(x, y);
  const start = { x: Math.round((b.minX + b.maxX) / 2 - w / 2), y: Math.round((b.minY + b.maxY) / 2 - h / 2) };
  if (fits(start.x, start.y)) return { type: 'rect', x: start.x, y: start.y, w, h };
  // 从中心往外一圈圈找（步长 = 短边的 1/12）
  const step = Math.max(4, Math.round(short / 12));
  for (let ring = 1; ring < 24; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (const dy of [-ring, ring]) {
        for (const [ox, oy] of [[dx, dy], [dy, dx]]) {
          const x = start.x + ox * step;
          const y = start.y + oy * step;
          if (x >= b.minX && y >= b.minY && x + w <= b.maxX && y + h <= b.maxY && fits(x, y)) return { type: 'rect', x, y, w, h };
        }
      }
    }
  }
  // 没空地：退回只要求在房间里
  if (inside(start.x, start.y)) return { type: 'rect', x: start.x, y: start.y, w, h };
  for (let ring = 1; ring < 24; ring += 1) {
    for (let d = -ring; d <= ring; d += 1) {
      for (const [ox, oy] of [[d, -ring], [d, ring], [-ring, d], [ring, d]]) {
        const x = start.x + ox * step;
        const y = start.y + oy * step;
        if (inside(x, y)) return { type: 'rect', x, y, w, h };
      }
    }
  }
  return null;
}

/** 同一房间里不重名：衣柜、衣柜 2、衣柜 3… */
export function nextFurnitureName(label: string, taken: string[]) {
  const names = new Set(taken);
  if (!names.has(label)) return label;
  for (let n = 2; n < 500; n += 1) if (!names.has(`${label} ${n}`)) return `${label} ${n}`;
  return `${label} ${Date.now() % 1000}`;
}
