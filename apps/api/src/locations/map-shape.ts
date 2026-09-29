import type { MapShape, MapViewBox, StorageLocationKind } from '@family/contracts';
import { pointInShape, polygonArea, shapeBounds, type MapPoint } from '@family/shared';

// 地图形状的纯函数校验（item-location-plan §2.2、§3 I2）：不碰库；几何函数在 @family/shared（编辑器同一套）。
// 规则：层格不上图；柜子画成矩形；坐标都在 viewBox 里；房间里的柜子 / 区域要落在房间内
// （外接框之内，且中心点在房间多边形里——房间常是凹多边形，逐角判会误伤贴墙的柜子）。

/**
 * 这个形状能不能记在这个位置上；能就返回 null，不能返回给人看的原因。
 * parentShape：房间下的柜子 / 区域传所在房间的形状（房间还没上图就是 null）。
 */
export function shapeProblem(
  shape: MapShape,
  viewBox: MapViewBox,
  kind: StorageLocationKind,
  parentShape: MapShape | null,
): string | null {
  if (kind === 'slot') return '层格不上图，在柜子详情里列';
  if (kind === 'container' && shape.type !== 'rect') return '柜子画成矩形';
  const bounds = shapeBounds(shape);
  if (bounds.maxX > viewBox.w || bounds.maxY > viewBox.h) return '形状超出了地图';
  if (shape.type === 'polygon' && polygonArea(shape.points) < 1) return '房间的顶点挤在一条线上了';
  if (kind === 'room') return null;
  if (!parentShape) return '先把所在的房间画到地图上';
  const room = shapeBounds(parentShape);
  if (bounds.minX < room.minX || bounds.minY < room.minY || bounds.maxX > room.maxX || bounds.maxY > room.maxY) {
    return '要画在所在的房间里';
  }
  const center: MapPoint = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return pointInShape(center, parentShape) ? null : '要画在所在的房间里';
}
