import { describe, expect, it } from 'vitest';
import { NO_LOCATION_KEY, groupInventory } from './inventory-groups';

const item = (name: string, category: '调料' | '主食', defaultLocationId: string | null) => ({ name, category, defaultLocationId });

describe('groupInventory', () => {
  const items = [item('酱油', '调料', 'shelf'), item('大米', '主食', 'room'), item('盐', '调料', null), item('醋', '调料', 'shelf')];
  const locations = [
    { id: 'room', pathLabel: '厨房' },
    { id: 'shelf', pathLabel: '厨房 / 吊柜 / 左' },
  ];

  it('按类别：和原来一样按出现顺序分组', () => {
    expect(groupInventory(items, 'category', locations).map((group) => [group.label, group.items.map((one) => one.name)])).toEqual([
      ['调料', ['酱油', '盐', '醋']],
      ['主食', ['大米']],
    ]);
  });

  it('按位置：按位置树顺序、用服务端路径做标题，没记位置（或位置已不在列表里）的放最后', () => {
    const groups = groupInventory([...items, item('糖', '调料', 'gone')], 'location', locations);
    expect(groups.map((group) => [group.label, group.items.map((one) => one.name)])).toEqual([
      ['厨房', ['大米']],
      ['厨房 / 吊柜 / 左', ['酱油', '醋']],
      ['没记位置', ['盐', '糖']],
    ]);
    expect(groups[2].key).toBe(NO_LOCATION_KEY);
  });
});
