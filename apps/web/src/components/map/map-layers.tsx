import type { KeyboardEvent, PointerEvent } from 'react';
import type { MapShape } from '@family/contracts';
import { labelPoint, shapeBounds, type MapBounds } from '@family/shared';
import { pathOf, type Corner } from './canvas-drag';
import { furnitureSpec } from './furniture-catalog';
import { FurnitureGlyph } from './furniture-icons';
import type { MapItem } from './map-types';

// 画布上的几层：房间里的柜子 / 家具、名字和家具图标（屏幕上大小不变，放不下就不写）、编辑手柄（房间顶点、柜子四角）。

/**
 * 房间里的一块块：收纳（柜子，含家具库放的）实线可点；区域虚线；装饰类家具（v2 §3.1）虚线淡色，
 * 看模式不可点（点穿到房间上），编辑时照样能选、能拖。
 */
export function MapInner({
  inner,
  shapeOf,
  selectedId,
  highlightIds,
  editing,
  unit,
  onPress,
  onSelect,
  onKey,
}: {
  inner: MapItem[];
  shapeOf: (item: MapItem) => MapShape;
  selectedId: string | null;
  highlightIds?: Set<string>;
  editing: boolean;
  unit: number;
  onPress: (event: PointerEvent, item: MapItem) => void;
  onSelect: (id: string) => void;
  onKey: (event: KeyboardEvent, id: string) => void;
}) {
  return (
    <>
      {inner.map((item) => {
        const active = item.id === selectedId;
        const hit = highlightIds?.has(item.id);
        const decor = item.kind === 'decor';
        const solid = item.kind === 'container';
        const inert = decor && !editing;
        return (
          <path
            key={item.id}
            d={pathOf(shapeOf(item))}
            role={inert ? undefined : 'button'}
            tabIndex={inert ? undefined : 0}
            aria-label={inert ? undefined : item.name}
            aria-pressed={inert ? undefined : active}
            data-map-container={decor ? undefined : item.id}
            data-map-decor={decor ? item.id : undefined}
            data-furniture={item.icon ?? undefined}
            data-hit={hit ? 'true' : undefined}
            onKeyDown={(event) => onKey(event, item.id)}
            onPointerDown={(event) => onPress(event, item)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item.id);
            }}
            className={
              'outline-none ' +
              (inert ? 'pointer-events-none ' : '') +
              (hit ? 'fill-warm-soft stroke-warm map-hit ' : active ? 'fill-accent-soft stroke-accent ' : solid || decor ? 'fill-surface stroke-[var(--map-stroke)] ' : 'fill-transparent stroke-[var(--map-stroke)] ') +
              (editing ? 'cursor-move' : 'cursor-pointer')
            }
            fillOpacity={hit || active ? 0.92 : solid ? 0.92 : decor ? 0.5 : 0}
            strokeOpacity={decor && !active ? 0.7 : 1}
            strokeWidth={(active || hit ? 2.5 : 1) * unit}
            strokeDasharray={solid ? undefined : `${4 * unit} ${3 * unit}`}
          />
        );
      })}
    </>
  );
}

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
        const shape = shapeOf(item);
        const b = shapeBounds(shape);
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        const spec = furnitureSpec(item.icon);
        const tone = item.kind === 'decor' ? 'text-ink-soft opacity-60' : 'text-ink-soft';
        if (spec) {
          const rotation = shape.type === 'rect' ? shape.rotation : 0;
          // 长条收纳（宽 > 2.6 倍深）：图标靠左、右边写名字；其他：图标取短边 80% 居中，不写字（装饰类不起名）
          if (item.kind !== 'decor' && w > 2.6 * h) {
            const size = h * 0.82;
            const gx = b.minX + h * 0.2;
            const tx = gx + size + h * 0.2;
            const px = Math.min(12, ((b.maxX - tx) * scale - 4) / Math.max(2, item.name.length), h * scale - 4);
            return (
              <g key={item.id}>
                {size * scale >= 8 ? <FurnitureGlyph kind={spec.key} x={gx} y={b.minY + (h - size) / 2} size={size} rotation={rotation} className={tone} /> : null}
                {px >= 8 ? (
                  <text x={tx} y={(b.minY + b.maxY) / 2} dominantBaseline="central" className="fill-ink-soft" style={{ fontSize: px * unit }}>
                    {item.name}
                  </text>
                ) : null}
              </g>
            );
          }
          const size = Math.min(w, h) * 0.8;
          if (size * scale < 8) return null;
          return <FurnitureGlyph key={item.id} kind={spec.key} x={b.minX + (w - size) / 2} y={b.minY + (h - size) / 2} size={size} rotation={rotation} className={tone} />;
        }
        // 柜子常是扁的：字号按宽、高一起收（最大 12px），小于 8px 才不写（放大就出来了）
        const px = Math.min(12, (w * scale - 8) / Math.max(2, item.name.length), h * scale - 4);
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
