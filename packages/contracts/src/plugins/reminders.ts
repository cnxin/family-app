// 提醒（J1.4）。提醒挂在别的域的事项上（日历条目、任务、点菜、投票、出行、资产维护）；
// reminders.module.ts 调 CalendarService.list 列可提醒的来源、用 tasks 的 taskOccursOn 校验任务当天是否发生，
// 都属跨插件引用，原样保留（J1b）。提醒的来源模块（sourceModule）是业务数据引用，不在这里。
// 还没有 agent 读工具（§8.2 缺项，J3 / J4 补）。
import type { PluginManifest } from './types';

export const remindersManifest = {
  key: 'reminders',
  name: '提醒',
  glyph: '醒',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
    { plugin: 'calendar', via: 'contract', uses: ['calendar.list'], reason: '列出可以加提醒的日历条目' },
    { plugin: 'tasks', via: 'contract', uses: ['tasks.occursOn'], reason: '任务提醒要确认那天确实有这次任务' },
  ],
  nav: [{ key: 'reminders', label: '提醒', glyph: '醒', scene: 'schedule', path: '/schedule/reminders' }],
  legacyPaths: [['/reminders', '/schedule/reminders']],
  module: {
    overridable: true,
    // 只算还会响的：没取消，且排着或时间还没到
    hasData: {
      kind: 'tables',
      tables: [{ table: 'reminders', where: `status <> 'cancelled' AND (status = 'scheduled' OR "remindAt" > now())` }],
    },
  },
  events: {
    routes: [{ prefix: '/reminders', domains: ['reminders', 'calendar'] }],
    queryKeys: ['reminders', 'reminder-sources'],
  },
  actions: [
    {
      id: 'reminders.create',
      label: '加一条提醒',
      keywords: ['别忘了'],
      deepLink: '/schedule/reminders?create=1',
      // 提醒会出现在日历上
      propose: { legacyTool: 'propose_reminder', actionType: 'reminder', label: '家庭提醒', domains: ['reminders', 'calendar'] },
    },
  ],
  usage: {
    label: '提醒',
    activityModules: ['reminder'],
    tables: [{ label: '提醒', table: 'reminders', memberColumn: 'createdById', createdColumn: 'createdAt' }],
  },
  notifications: [{ key: 'reminder', label: '提醒', icon: '🔔' }],
} as const satisfies PluginManifest;
