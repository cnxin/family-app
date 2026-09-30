import type { PointerEvent } from 'react';
import type { MapShape } from '@family/contracts';
import { labelPoint, shapeBounds, type MapBounds } from '@family/shared';
import type { Corner } from './canvas-drag';
import type { MapItem } from './map-types';

// 画布上的两层：名字（屏幕上大小不变，放不下就不写）和编辑手柄（房间顶点、柜子对角）。

/** 房名位置要网格搜索，缩放平移时每帧都重画：按形状缓存，形状不变就不重算 */
const labelCache = new Map<string, [number, number]>();
function cachedLabel(shape: MapShape, avoid: MapBounds[]) {
  const key = JSON.stringify([shape, avoid]);
  let point = labelCache.get(key);
  if (!point) {
    point = labelPoint(shape, avoid);
    if (labelCache.size > 400) labelCache.clear();
    labelCache.set(key, point);
  }
  return point;
}

export function MapLabels({
  rooms,
  inner,
  shapeOf,
  scale,
}: {
  rooms: MapItem[];
  inner: MapItem[];
  shapeOf: (item: MapItem) => MapShape;
  scale: number;
}) {
  const unit = 1 / scale;
  /** 屏幕上 9～max px，按房间在屏幕上的宽度和字数缩 */
  const fontFor = (bounds: MapBounds, name: string, max: number) => {
    const width = (bounds.maxX - bounds.minX) * scale;
    return Math.max(9, Math.min(max, (width - 8) / Math.max(2, name.length))) * unit;
  };
  return (
    <g className="pointer-events-none" aria-hidden="true">
      {rooms.map((room) => {
        const shape = shapeOf(room);
        const [x, y] = cachedLabel(shape, inner.filter((one) => one.parentId === room.id).map((one) => shapeBounds(shapeOf(one))));
        return (
          <text key={room.id} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-ink font-medium"
            style={{ fontSize: fontFor(shapeBounds(shape), room.name, 14) }}>
            {room.name}
          </text>
        );
      })}
      {inner.map((item) => {
        const b = shapeBounds(shapeOf(item));
        // 柜子常是扁的：字号按宽、高一起收（最大 12px），小于 8px 才不写（放大就出来了）
        const px = Math.min(12, ((b.maxX - b.minX) * scale - 8) / Math.max(2, item.name.length), (b.maxY - b.minY) * scale - 4);
        if (px < 8) return null;
        const size = px * unit;
        return (
          <text key={item.id} x={(b.minX + b.maxX) / 2} y={(b.minY + b.maxY) / 2} textAnchor="middle" dominantBaseline="central"
            className="fill-ink-soft" style={{ fontSize: size }}>
            {item.name}
          </text>
        );
      })}
    </g>
  );
}

export function MapHandles({
  item,
  shape,
  size,
  unit,
  onVertexDown,
  onVertexDelete,
  onResizeDown,
  selectedVertex = null,
}: {
  /** 点选中的顶点：画成实心 */
  selectedVertex?: number | null;
  item: MapItem;
  shape: MapShape;
  /** 手柄半径（地图单位；粗指针更大） */
  size: number;
  unit: number;
  onVertexDown: (event: PointerEvent, index: number) => void;
  onVertexDelete: (index: number) => void;
  onResizeDown: (event: PointerEvent, corner: Corner) => void;
}) {
  if (shape.type === 'polygon') {
    return (
      <g>
        {shape.points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={size}
            data-map-vertex={index}
            data-selected={index === selectedVertex ? 'true' : undefined}
            className={'cursor-grab stroke-accent ' + (index === selectedVertex ? 'fill-accent' : 'fill-surface')}
            strokeWidth={2 * unit}
            onPointerDown={(event) => event.button === 0 && onVertexDown(event, index)}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onVertexDelete(index);
            }}
          />
        ))}
      </g>
    );
  }
  if (item.kind === 'room') return null;
  return (
    <g>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <rect
          key={corner}
          x={(corner.includes('w') ? shape.x : shape.x + shape.w) - size}
          y={(corner.includes('n') ? shape.y : shape.y + shape.h) - size}
          width={size * 2}
          height={size * 2}
          data-map-resize={corner}
          className={(corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize') + ' fill-surface stroke-accent'}
          strokeWidth={2 * unit}
          onPointerDown={(event) => event.button === 0 && onResizeDown(event, corner)}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
    </g>
  );
}
