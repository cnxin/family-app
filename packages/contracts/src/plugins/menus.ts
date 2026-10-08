// 点菜（J1.4）。一个插件两段导航：点菜（order）、厨房（kitchen），导航 key 登记在 keys.ts 的别名表。
// menus.module.ts 用菜谱的 buildRecipeSnapshot 给菜单项拍做法快照，属跨插件引用，原样保留（J1b）。
// 「确认用料」POST /menus/:id/confirm-consumption 写在 inventory.module.ts（扣库存），路径挂在点菜下；
// 归库存插件（2026-10-06 King 拍板），登记在 inventory.ts。
// ⌘K 还没有点菜动作（§8.2 缺项，J3 补），写提案先放在 proposals。
import type { PluginManifest } from './types';

export const menusManifest = {
  key: 'menus',
  name: '点菜',
  glyph: '点',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    { plugin: 'recipes', via: 'contract', uses: ['recipes.snapshot'], reason: '菜单项记下点菜时的做法快照' },
  ],
  nav: [
    { key: 'order', label: '点菜', glyph: '点', scene: 'eat', path: '/eat/order', mobileTab: 'eat' },
    { key: 'kitchen', label: '厨房', glyph: '厨', scene: 'eat', path: '/eat/kitchen', mobileTab: 'eat' },
  ],
  legacyPaths: [['/order', '/eat/order'], ['/kitchen', '/eat/kitchen']],
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    routes: [{ prefix: '/menus' }, { prefix: '/menu-items' }],
    queryKeys: ['menus-of-date', 'menu', 'menu-dates', 'menu-events', 'menu-inventory-preview'],
  },
  proposals: [{ actionType: 'menu', label: '菜单点菜' }],
  queries: [
    { id: 'menus.meal-plan', label: '某天的菜单', server: 'menus.meal-plan', toolName: 'get_meal_plan' },
    { id: 'menus.dish-plan', label: '一段日子的点菜安排', server: 'menus.dish-plan', toolName: 'get_dish_plan' },
  ],
  usage: {
    label: '点菜（智能菜单）',
    activityModules: ['menu'],
    // 点菜 / 厨房的操作另记在 menu_events（每行一次操作）；createdAt 是不带时区的 timestamp
    tables: [{ label: '点菜 / 厨房', table: 'menu_events', memberColumn: 'actorId', createdColumn: 'createdAt', createdTz: false, log: true }],
  },
  notifications: [{ key: 'menu', label: '菜单', icon: '🍲' }],
  capabilities: [
    { key: 'place_meal_order', roles: ['owner', 'admin', 'member'] },
    { key: 'update_meal_status', roles: ['owner', 'admin', 'member'] },
  ],
} as const satisfies PluginManifest;
