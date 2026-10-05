// 日历（J1.4）。日历视图把任务、提醒、点菜、来访等别的域的条目合在一起显示；
// calendar.module.ts 直接调 TasksService.list 取任务条目，属跨插件 Service 调用，原样保留（J1b）。
// 写日历的路由只有 /calendar-events；任务、提醒、资产、来访、小管家提案等也会推 calendar 域，那些登记在各自的域里。
// 日历条目的来源模块（sourceModule）与 components/calendar-views.tsx 的来源图标是业务数据引用，不在这里。
import type { PluginManifest } from './types';

export const calendarManifest = {
  key: 'calendar',
  name: '日历',
  glyph: '历',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    { plugin: 'tasks', via: 'contract', uses: ['tasks.list'], reason: '日历视图里显示当天的任务' },
  ],
  nav: [{ key: 'calendar', label: '日历', glyph: '历', scene: 'schedule', path: '/schedule/calendar', mobileTab: 'schedule' }],
  legacyPaths: [['/calendar', '/schedule/calendar']],
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    routes: [{ prefix: '/calendar-events' }],
    queryKeys: ['calendar'],
  },
  actions: [
    { id: 'calendar.create', label: '加日程', keywords: ['事件'], deepLink: '/schedule/calendar?create=1' },
  ],
  queries: [
    { id: 'calendar.range', label: '一段日子里的日程', server: 'calendar.range', legacyTool: 'get_calendar' },
  ],
  usage: {
    label: '日历',
    activityModules: ['calendar'],
    tables: [{ label: '日历', table: 'calendar_events', memberColumn: 'createdById', createdColumn: 'createdAt' }],
  },
  notifications: [{ key: 'calendar', label: '日历', icon: '📅' }],
} as const satisfies PluginManifest;
