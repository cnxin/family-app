// 位置（J1.5）。位置字典（房间 → 柜子 / 区域 → 层格）与家庭地图；库存、批次、资产引用位置。
// 没有对外的 Service 依赖；库存、资产用本插件的 usableLocationId 函数，属它们那边的跨插件引用（J1b）。
// 写位置的路由以本域为主的只有 /locations、/map；库存、批次、资产、买到后入库等改位置的路由登记在各自的域。
import type { PluginManifest } from './types';

export const locationsManifest = {
  key: 'locations',
  name: '地图',
  glyph: '图',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'locations', label: '地图', glyph: '图', scene: 'house', path: '/house/map' }],
  module: {
    overridable: true,
    // I1：「未整理」和家人挂在它下面的之外，家里有任何一个没归档的位置（管理员整理过才算这个域有数据）。
    // 子查询按外层表名关联父位置，不用别名，现有 tables[].where 就能表达
    hasData: {
      kind: 'tables',
      tables: [{
        table: 'storage_locations',
        where: `"systemKey" IS NULL AND "archivedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM storage_locations p WHERE p.id = storage_locations."parentId" AND p."systemKey" IS NOT NULL)`,
      }],
    },
  },
  events: {
    routes: [
      // 归档 / 合并 / 拆分位置会把库存、资产挪到别处
      { prefix: '/locations', domains: ['locations', 'inventory', 'assets'] },
      { prefix: '/map' },
    ],
    queryKeys: ['locations'],
  },
  actions: [
    // 落点在库存页：「记一下东西放哪」是在库存页里挑物品、选位置
    { id: 'locations.locate', label: '记一下东西放哪', keywords: ['位置', '放在哪', '柜子'], deepLink: '/house/inventory?locate=1' },
  ],
  queries: [
    { id: 'locations.find-item', label: '某样东西放在哪', server: 'locations.find-item', toolName: 'find_item' },
    { id: 'locations.contents', label: '某个位置里有什么', server: 'locations.contents', toolName: 'list_location_contents' },
  ],
  usage: {
    label: '位置',
    uncounted: ['位置：storage_locations 与库存 / 批次 / 资产的位置列都没有操作人，只给现状快照（见各家庭「位置」一段），不按成员计数'],
    snapshots: [{ server: 'locations.snapshot', label: '位置' }],
  },
} as const satisfies PluginManifest;
