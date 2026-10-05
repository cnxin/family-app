// 购物（J1.4）。路径在 /house 下，手机底栏放在「吃饭」tab。
// shopping.module.ts 直接读 Menu / InventoryItem / InventoryTransaction 实体（共用 entities/index.ts），属跨插件引用（J1b）。
// 「买到后入库」POST /shopping-items/:id/confirm-stock 写在 inventory.module.ts，归库存插件（§8.6 第 4 条），不在这里登记。
import type { PluginManifest } from './types';

export const shoppingManifest = {
  key: 'shopping',
  name: '购物',
  glyph: '购',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    { plugin: 'menus', via: 'contract', uses: ['GET /menus'], reason: '按菜单生成购物清单（POST /shopping-list/generate）' },
    { plugin: 'inventory', via: 'contract', uses: ['GET /inventory-items'], reason: '生成清单时扣掉已有库存' },
  ],
  nav: [{ key: 'shopping', label: '购物', glyph: '购', scene: 'house', path: '/house/shopping', mobileTab: 'eat' }],
  legacyPaths: [['/shopping', '/house/shopping'], ['/supplies', '/house/shopping']],
  // core 层不进 /system/modules，没有开关
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    routes: [
      { prefix: '/shopping-list' },
      { prefix: '/shopping-items', domains: ['shopping', 'inventory'] },
    ],
    queryKeys: ['shopping', 'shopping-inventory-preview'],
  },
  actions: [
    {
      id: 'shopping.add',
      label: '加到购物清单',
      keywords: ['要买'],
      deepLink: '/house/shopping?create=1',
      propose: { legacyTool: 'propose_shopping_items', actionType: 'shopping', label: '购物清单' },
      capability: 'manage_shopping',
    },
  ],
  queries: [
    { id: 'shopping.list', label: '购物清单里有什么', server: 'shopping.list', legacyTool: 'get_shopping_list' },
  ],
  usage: {
    label: '购物',
    activityModules: ['shopping'],
    uncounted: ['购物：shopping_items 没有创建时间和创建人列，无法按成员计数'],
  },
  capabilities: [{ key: 'manage_shopping', roles: ['owner', 'admin', 'member'] }],
} as const satisfies PluginManifest;
