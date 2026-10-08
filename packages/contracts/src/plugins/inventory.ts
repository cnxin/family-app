// 库存（J1.5）。物品、批次、出入库流水；用位置的 usableLocationId 校验默认位置，属跨插件引用（J1b）。
// 「买到后入库」POST /shopping-items/:id/confirm-stock（§8.6 第 4 条）与「确认用料」POST /menus/:id/confirm-consumption
// （2026-10-06 King 拍板）都写在 inventory.module.ts、归本插件；路径挂在购物 / 点菜下，推送的域照旧带上它们。
// ⌘K 还没有库存动作（§8.2 缺项，J3 补）。
import type { PluginManifest } from './types';

export const inventoryManifest = {
  key: 'inventory',
  name: '库存',
  glyph: '库',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
    { plugin: 'locations', via: 'contract', uses: ['locations.usableLocationId'], reason: '物品默认位置、批次位置要是家里还在用的位置' },
  ],
  // J1b：物品默认位置、批次位置、入库放哪儿的检查走位置门面
  dependsOn: ['locations'],
  nav: [{ key: 'inventory', label: '库存', glyph: '库', scene: 'house', path: '/house/inventory' }],
  legacyPaths: [['/inventory', '/house/inventory']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'inventory_items' }] } },
  events: {
    routes: [
      { prefix: '/inventory-items', domains: ['inventory', 'shopping', 'locations'] },
      { prefix: '/inventory-batches', domains: ['inventory', 'locations'] },
      { prefix: '/inventory-transactions' },
      { prefix: '/shopping-items/:id/confirm-stock', domains: ['shopping', 'inventory', 'locations'] },
      { prefix: '/menus/:id/confirm-consumption', domains: ['menus', 'inventory'] },
    ],
    queryKeys: [
      'inventory', 'inventory-batches', 'inventory-transactions',
      'menu-inventory-preview', 'shopping-inventory-preview', 'maintenance-consumables-preview',
    ],
  },
  attention: {
    label: '库存',
    actionLabel: '看库存',
    listActionLabel: '看库存',
    path: '/house/inventory',
    order: 4,
    mergedTitle: '{n} 样快过期',
    mergedOverdueTitle: '{n} 样快过期，有的已经过期了',
    kinds: [
      { kind: 'expiry', server: 'inventory.expiry', actionLabel: '看库存', title: '{name} {soon}过期' },
    ],
  },
  queries: [
    { id: 'inventory.alerts', label: '库存提醒', server: 'inventory.alerts' },
    { id: 'inventory.summary', label: '库存摘要', server: 'inventory.summary' },
  ],
  usage: {
    label: '库存',
    activityModules: ['inventory'],
    tables: [{ label: '库存', table: 'inventory_transactions', memberColumn: 'actorId', createdColumn: 'createdAt' }],
  },
  capabilities: [{ key: 'manage_inventory', roles: ['owner', 'admin', 'member'] }],
} as const satisfies PluginManifest;
