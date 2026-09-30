import type { HouseholdMap, StorageLocation } from '@family/contracts';
import { furnitureSpec } from './furniture-catalog';
import type { MapItem } from './map-types';

// 位置 + 装饰 → 画布上的一块块（看模式、编辑器共用）。装饰排在最前：画在柜子下面，柜子照样点得到。

export function locationItem(location: StorageLocation): MapItem | null {
  if (!location.mapShape || location.archivedAt || location.kind === 'slot') return null;
  return { id: location.id, parentId: location.parentId, kind: location.kind, name: location.name, shape: location.mapShape, icon: location.icon };
}

export function mapItems(locations: StorageLocation[], decorations: HouseholdMap['decorations'] = []): MapItem[] {
  const decor: MapItem[] = decorations.map((one) => ({
    id: one.id,
    parentId: one.roomId,
    kind: 'decor',
    name: furnitureSpec(one.kind)?.label ?? '家具',
    icon: one.kind,
    shape: { type: 'rect', x: one.x, y: one.y, w: one.w, h: one.h, ...(one.rotation ? { rotation: one.rotation } : {}) },
  }));
  return [...decor, ...locations.map(locationItem).filter((one): one is MapItem => one !== null)];
}
