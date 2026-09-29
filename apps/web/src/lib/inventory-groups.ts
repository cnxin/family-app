import type { InventoryCategory } from '@family/contracts';

export type InventoryGrouping = 'category' | 'location';
export const NO_LOCATION_KEY = 'no-location';

interface Groupable {
  category: InventoryCategory;
  defaultLocationId: string | null;
}

/**
 * 库存列表分组（I1 起多一种「按位置」）。按位置时按位置树的先序排（和管理页、选择器一个顺序），
 * 物品的位置是「上次放在」的默认位置；没记的归「没记位置」放最后。
 */
export function groupInventory<T extends Groupable>(
  items: T[],
  grouping: InventoryGrouping,
  locations: { id: string; pathLabel: string }[],
): { key: string; label: string; items: T[] }[] {
  if (grouping === 'category') {
    const map = new Map<InventoryCategory, T[]>();
    for (const item of items) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()].map(([category, rows]) => ({ key: category, label: category, items: rows }));
  }
  const order = new Map(locations.map((one, index) => [one.id, index]));
  const labels = new Map(locations.map((one) => [one.id, one.pathLabel]));
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = item.defaultLocationId && labels.has(item.defaultLocationId) ? item.defaultLocationId : NO_LOCATION_KEY;
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(([key, rows]) => ({ key, label: labels.get(key) ?? '没记位置', items: rows }));
}
