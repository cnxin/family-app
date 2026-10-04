// 菜谱（J1.2）。路径在 /eat 下，但和点菜（menus）是两个插件；点菜会快照菜谱，属跨插件引用（J1b）。
import type { PluginManifest } from './types';

export const recipesManifest = {
  key: 'recipes',
  name: '菜谱',
  glyph: '菜',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'recipes', label: '菜谱', glyph: '菜', scene: 'eat', path: '/eat/recipes' }],
  legacyPaths: [['/recipes', '/eat/recipes']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'dishes' }] } },
  events: {
    routes: [
      // 成员的拿手菜挂在成员路径下，但写的是菜谱域的数据
      { prefix: '/members/:memberId/dish-skills' },
      { prefix: '/member-dish-skills' },
      { prefix: '/dishes' },
      { prefix: '/recipe-variants' },
    ],
    queryKeys: ['recipes', 'recipe', 'dishes'],
  },
  actions: [
    { id: 'recipes.create-dish', label: '新建菜品', keywords: ['菜'], deepLink: '/eat/recipes?create=1', capability: 'manage_recipes' },
  ],
  queries: [
    { id: 'recipes.search', label: '搜家里的菜谱', server: 'recipes.search', legacyTool: 'search_recipes' },
  ],
  usage: {
    label: '菜谱',
    activityModules: ['recipe'],
    tables: [{ label: '菜谱', table: 'dishes', memberColumn: 'createdBy', createdColumn: 'createdAt', createdTz: false }],
    uncounted: ['菜谱做法：dish_recipe_variants 没有创建人列，未计入'],
  },
  capabilities: [{ key: 'manage_recipes', roles: ['owner', 'admin', 'member'] }],
} as const satisfies PluginManifest;
