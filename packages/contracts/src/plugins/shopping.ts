// J0 草稿：购物。每个字段注明现在登记在哪；未接线，J1 才改成由它生成。
import type { PluginManifest } from './types';

export const shoppingManifest = {
  key: 'shopping',
  name: '购物',
  glyph: '购',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    // shopping.module.ts 现在直接读 Menu / InventoryItem / InventoryTransaction 实体（共用 entities/index.ts）
    { plugin: 'menus', via: 'contract', uses: ['GET /menus'], reason: '按菜单生成购物清单（POST /shopping-list/generate）' },
    { plugin: 'inventory', via: 'contract', uses: ['GET /inventory-items'], reason: '生成清单时扣掉已有库存' },
    // POST /shopping-items/:id/confirm-stock 写在 inventory.module.ts 里，路径却挂在购物下；J1 要定归属
    { plugin: 'inventory', via: 'contract', uses: ['POST /shopping-items/:id/confirm-stock'], reason: '买到后入库' },
  ],
  // nav.ts：house 场景 core 段；手机底栏放在「吃饭」tab
  nav: [{ key: 'shopping', label: '购物', glyph: '购', scene: 'house', path: '/house/shopping', tier: 'core', mobileTab: 'eat' }],
  legacyPaths: [['/shopping', '/house/shopping'], ['/supplies', '/house/shopping']], // routes.ts MOVED
  // core 层不进 /system/modules，没有开关
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    // events.ts EVENT_ROUTES
    routes: [
      { prefix: '/shopping-list' },
      { prefix: '/shopping-items', domains: ['shopping', 'inventory'] },
      { prefix: '/shopping-items/:id/confirm-stock', domains: ['shopping', 'inventory', 'locations'] },
    ],
    queryKeys: ['shopping', 'shopping-inventory-preview'], // web lib/events.ts
  },
  actions: [
    {
      id: 'shopping.add', // actions.ts 'shopping'
      label: '加到购物清单',
      keywords: ['要买'],
      deepLink: '/house/shopping?create=1',
      slots: { item: 'item', quantity: 'quantity?', unit: 'unit?' },
      templates: ['把{item}加进清单', '要买{item}', '买{quantity}{unit}{item}'],
      propose: { legacyTool: 'propose_shopping_items', actionType: 'shopping', label: '购物清单' },
      capability: 'manage_shopping',
    },
  ],
  queries: [
    {
      id: 'shopping.list',
      label: '购物清单里有什么',
      templates: ['清单里有什么', '还要买什么', '{item}在清单里吗'],
      slots: { item: 'item?' },
      server: 'shopping.list',
      legacyTool: 'get_shopping_list',
    },
  ],
  usage: {
    label: '购物',
    activityModules: ['shopping'],
    uncounted: ['shopping_items 没有创建时间和创建人列，无法按成员计数'],
  },
  capabilities: [{ key: 'manage_shopping', roles: ['owner', 'admin', 'member'] }],
} as const satisfies PluginManifest;
