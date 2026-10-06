// 资产（J1.5）。家电、订阅、维护计划与耗材、资料。
// 维护消耗耗材时直接调库存的 InventoryTransactionsService 记出库、用位置的 usableLocationId 校验位置，
// 都属跨插件引用，原样保留（J1b）。资产续费生成的财务流水（sourceType 'asset'）是业务数据引用，不在这里。
// 推资产的 7 条路由里，/locations（归档 / 合并位置会挪资产）以位置为主，登记在 locations.ts。
import type { PluginManifest } from './types';

export const assetsManifest = {
  key: 'assets',
  name: '资产',
  glyph: '资',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
    { plugin: 'inventory', via: 'contract', uses: ['inventory.transactions'], reason: '维护用掉的耗材从库存出库' },
    { plugin: 'locations', via: 'contract', uses: ['locations.usableLocationId'], reason: '资产放的位置要是家里还在用的位置' },
  ],
  nav: [{ key: 'assets', label: '资产', glyph: '资', scene: 'house', path: '/house/assets' }],
  // 三条旧路径在 routes.ts MOVED 里原本分在两处；它们互不为前缀、也不和中间的条目重叠，合到一处换算结果不变
  legacyPaths: [['/assets', '/house/assets'], ['/home-assets', '/house/assets'], ['/asset', '/house/assets']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'home_assets' }] } },
  events: {
    routes: [
      // 资产带维护提醒、日历条目和位置
      { prefix: '/assets', domains: ['assets', 'reminders', 'calendar', 'locations'] },
      { prefix: '/assets/:id/location', domains: ['assets', 'locations'] },
      { prefix: '/asset-documents' },
      { prefix: '/maintenance-plans', domains: ['assets', 'reminders', 'calendar', 'inventory'] },
      { prefix: '/maintenance-plans/:id/shopping-items', domains: ['assets', 'shopping'] },
      { prefix: '/maintenance-consumables', domains: ['assets', 'inventory'] },
    ],
    queryKeys: ['assets', 'asset', 'maintenance-consumables-preview'],
  },
  attention: {
    label: '资产',
    actionLabel: '看这件资产',
    listActionLabel: '看资产',
    path: '/house/assets',
    order: 1,
    mergedTitle: '{n} 件资产该保养了',
    mixedTitle: '{n} 件资产要处理',
    kinds: [
      {
        kind: 'maintenance',
        server: 'assets.maintenance',
        actionLabel: '看这件资产',
        path: '/house/assets/{id}',
        // 「净水器滤芯 3 天后该换了」是 ia-plan F5b 的原话
        title: '{name} {soon}该换了',
      },
      {
        kind: 'renewal',
        server: 'assets.renewal',
        actionLabel: '看这件资产',
        path: '/house/assets/{id}',
        title: '{name} {soon}该续费了',
        mergedTitle: '{n} 项订阅该续费了',
      },
      {
        kind: 'warranty',
        server: 'assets.warranty',
        actionLabel: '看这件资产',
        path: '/house/assets/{id}',
        title: '{name} {soon}保修到期',
        mergedTitle: '{n} 件资产保修快到期',
      },
    ],
  },
  actions: [
    { id: 'assets.create', label: '登记一件资产', keywords: ['家电'], deepLink: '/house/assets?create=1', capability: 'manage_assets' },
  ],
  queries: [
    { id: 'assets.detail', label: '某件资产的详情', server: 'assets.detail', legacyTool: 'get_asset_detail' },
  ],
  usage: { label: '资产', activityModules: ['asset'] },
  capabilities: [{ key: 'manage_assets', roles: ['owner', 'admin', 'member'] }],
} as const satisfies PluginManifest;
