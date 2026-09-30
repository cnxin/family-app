import type { MapRect, MapRotation, MapShape, StorageLocation } from '@family/contracts';
import { alignToNeighbours, rectangularize, shapeBounds, shapePoints, type MapPoint } from '@family/shared';

// 编辑器里「更多」和工具条上那些一键操作的纯计算（地图编辑器 v2 §2.2）；执行、记撤销在编辑器里。

/** 这个位置和它下面所有位置（不含归档的） */
export function subtreeOf(locations: StorageLocation[], id: string): StorageLocation[] {
  const out: StorageLocation[] = [];
  const walk = (parent: string) => {
    for (const one of locations) {
      if (one.parentId === parent && !one.archivedAt) {
        out.push(one);
        walk(one.id);
      }
    }
  };
  walk(id);
  return out;
}

/** 「从图上拿掉」的后果（拍板 2：确认框里写清楚），和要清掉形状的那些位置 */
export function removalPlan(locations: StorageLocation[], location: StorageLocation) {
  const below = subtreeOf(locations, location.id);
  const shapedBelow = below.filter((one) => one.mapShape);
  const things = [location, ...below].reduce((sum, one) => sum + one.itemCount, 0);
  const body =
    location.kind === 'room'
      ? `「${location.name}」${shapedBelow.length ? `和里面 ${shapedBelow.length} 个柜子` : ''}从地图上拿掉。位置${things ? `和记着的 ${things} 件东西` : ''}都还在清单里，入库照样选得到；要再显示得重新画上去，拿掉后不能撤销。`
      : `「${location.name}」从地图上拿掉。它${things ? `和里面记着的 ${things} 件东西` : ''}还在清单里（${location.pathLabel}）；拿掉后不能撤销。`;
  return { body, ids: [...shapedBelow.map((one) => one.id), location.id] };
}

/** 转 90°：绕中心换宽高，朝向 +90（家具图标跟着转，v2 §3.4）；转过来出了房间就返回 null */
export function turned(shape: MapShape, parent: MapShape | null | undefined): MapRect | null {
  if (shape.type !== 'rect') return null;
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const rotation = (((shape.rotation ?? 0) + 90) % 360) as MapRotation;
  const next: MapRect = { type: 'rect', x: Math.round(cx - shape.h / 2), y: Math.round(cy - shape.w / 2), w: shape.h, h: shape.w, ...(rotation ? { rotation } : {}) };
  const b = parent ? shapeBounds(parent) : null;
  if (b && (next.x < b.minX || next.y < b.minY || next.x + next.w > b.maxX || next.y + next.h > b.maxY)) return null;
  return next;
}

export const toPolygon = (shape: MapShape): MapShape => (shape.type === 'polygon' ? shape : { type: 'polygon', points: shapePoints(shape) });

/** 其他房间的顶点（吸附、对齐用） */
export function neighbourPoints(locations: StorageLocation[], roomId: string): MapPoint[][] {
  return locations
    .filter((one) => one.kind === 'room' && one.id !== roomId && one.mapShape && !one.archivedAt)
    .map((one) => shapePoints(one.mapShape!));
}

export function rectangularized(shape: MapShape): MapShape {
  return { type: 'polygon', points: rectangularize(shape) };
}

/** 对齐相邻：12 单位以内、同向、有重叠的边挪到邻居墙上；一条都没有就返回 null */
export function aligned(shape: MapShape, neighbours: MapPoint[][]): { shape: MapShape; moved: number } | null {
  const { points, moved } = alignToNeighbours(shapePoints(shape), neighbours, 12);
  return moved ? { shape: { type: 'polygon', points }, moved } : null;
}

/** 删一个顶点：至少留 3 个 */
export function withoutVertex(shape: MapShape, index: number): MapShape | null {
  if (shape.type !== 'polygon' || shape.points.length <= 3) return null;
  return { type: 'polygon', points: shape.points.filter((_, i) => i !== index) };
}
