import type { ReactNode } from 'react';
import type { MapRotation } from '@family/contracts';
import type { FurnitureKey } from './furniture-catalog';

// 家具库的 18 个顶视图图标（地图编辑器 v2 §3.3）：24×24 线条、currentColor，示意稿那套初稿。
// 默认朝向按「横放」画（衣柜宽 > 深）；rotation 转 90° 时图标跟着转。线宽不随缩放变粗（index.css .map-glyph）。

const PATHS: Record<FurnitureKey, ReactNode> = {
  wardrobe: (<><rect x="3" y="6" width="18" height="12" rx="1" /><path d="M12 6v12M10 11v2M14 11v2" /></>),
  shoe: (<><rect x="3" y="7" width="18" height="10" rx="1" /><path d="M3 12h18M7 9.5h2M15 14.5h2" /></>),
  tv: (<><rect x="3" y="10" width="18" height="7" rx="1" /><path d="M6 8h12" strokeWidth="2.2" /><path d="M9 13.5h6" /></>),
  wall: (<><rect x="3" y="8" width="18" height="8" rx="1" strokeDasharray="2.2 1.8" /><path d="M9 8v8M15 8v8" /></>),
  base: (<><rect x="3" y="8" width="18" height="8" rx="1" /><path d="M9 8v8M15 8v8M6 12h1M11.5 12h1M17 12h1" /></>),
  fridge: (<><rect x="6" y="4" width="12" height="16" rx="1.5" /><path d="M6 9h12M9 6.5v1M9 11.5v3" /></>),
  bookcase: (<><rect x="3" y="8" width="18" height="8" rx="1" /><path d="M6 9.5v5M8 9.5v5M10.5 9.5v5M13 9.5v5M15 9.5v5M18 9.5v5" /></>),
  nightstand: (<><rect x="6" y="6" width="12" height="12" rx="1.5" /><circle cx="12" cy="12" r="3" /></>),
  shelf: (<><rect x="3" y="7" width="18" height="10" rx="1" /><path d="M3 12h18M9 7v10M15 7v10" /></>),
  drawers: (<><rect x="4" y="5" width="16" height="14" rx="1" /><path d="M4 9.7h16M4 14.3h16M11 7.3h2M11 12h2M11 16.6h2" /></>),
  sofa: (<><path d="M4 8h16v9H4z" /><path d="M4 8v-1.5h16V8M4 12h16" /><path d="M4 8v9M20 8v9" strokeWidth="2.4" /></>),
  bed: (<><rect x="5" y="3" width="14" height="18" rx="1.5" /><rect x="6.5" y="4.5" width="4.5" height="3" rx="1" /><rect x="13" y="4.5" width="4.5" height="3" rx="1" /><path d="M5 10h14" /></>),
  dining: (<><rect x="6" y="8" width="12" height="8" rx="1" /><path d="M8 5.5h2M14 5.5h2M8 18.5h2M14 18.5h2" strokeWidth="2" /></>),
  desk: (<><rect x="3" y="6" width="18" height="7" rx="1" /><circle cx="12" cy="17" r="2.6" /></>),
  toilet: (<><rect x="7" y="3" width="10" height="4" rx="1" /><ellipse cx="12" cy="14" rx="4.5" ry="6" /></>),
  bathtub: (<><rect x="3" y="6" width="18" height="12" rx="3" /><rect x="5.5" y="8.5" width="13" height="7" rx="2.5" /><circle cx="16.5" cy="12" r="0.9" /></>),
  washer: (<><rect x="5" y="5" width="14" height="14" rx="1.5" /><circle cx="12" cy="12.5" r="4" /><path d="M7.5 7.5h2" /></>),
  stove: (<><rect x="3" y="7" width="18" height="10" rx="1" /><circle cx="8.5" cy="12" r="2.6" /><circle cx="15.5" cy="12" r="2.6" /></>),
};

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** 面板、列表里用的图标（HTML 里） */
export function FurnitureIcon({ kind, className = 'size-6' }: { kind: FurnitureKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...STROKE}>
      {PATHS[kind]}
    </svg>
  );
}

/** 画布里画在家具框内的图标（地图坐标）；转向绕图标中心 */
export function FurnitureGlyph({
  kind,
  x,
  y,
  size,
  rotation = 0,
  className,
}: {
  kind: FurnitureKey;
  x: number;
  y: number;
  size: number;
  rotation?: MapRotation;
  className?: string;
}) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" overflow="visible" className={'map-glyph pointer-events-none ' + (className ?? '')} {...STROKE}>
      <g transform={rotation ? `rotate(${rotation} 12 12)` : undefined}>{PATHS[kind]}</g>
    </svg>
  );
}
