// 出行（J1.1）。
import type { PluginManifest } from './types';

export const travelManifest = {
  key: 'travel',
  name: '出行',
  glyph: '行',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'travel', label: '出行', glyph: '行', scene: 'life', path: '/life/travel' }],
  legacyPaths: [['/travel', '/life/travel']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'travel_plans' }] } },
  events: {
    routes: [
      // 行程会同步日历条目和出发提醒
      { prefix: '/travel-plans', domains: ['travel', 'calendar', 'reminders'] },
      { prefix: '/travel-templates' },
    ],
    queryKeys: ['travel-plans', 'travel-plan', 'travel-templates'],
  },
  attention: {
    label: '出行',
    actionLabel: '看清单',
    listActionLabel: '看行程',
    path: '/life/travel',
    order: 3,
    mergedTitle: '{n} 个行程还没准备好',
    kinds: [
      {
        kind: 'checklist',
        server: 'travel.checklist',
        actionLabel: '看清单',
        path: '/life/travel/{id}',
        title: '{name} {soon}出发，清单还没准备好',
      },
    ],
  },
  actions: [
    { id: 'travel.create', label: '新建行程', keywords: ['旅行'], deepLink: '/life/travel?create=1' },
  ],
  queries: [
    { id: 'travel.checklist', label: '行程的协作清单', server: 'travel.checklist' },
  ],
  usage: { label: '出行', activityModules: ['travel'] },
} as const satisfies PluginManifest;
