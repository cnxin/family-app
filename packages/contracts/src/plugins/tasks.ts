// 任务（家务，J1.4）。
// tasks.module.ts 在打勾的同一个事务里调 PointsService.awardTaskCompletion / reverseTaskAward：事务内的跨插件调用，
// 原样保留，J1b 改走内核的「事务内钩子」（§8.6 第 2 条）。
import type { PluginManifest } from './types';

export const tasksManifest = {
  key: 'tasks',
  name: '任务',
  glyph: '待',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    { plugin: 'points', via: 'contract', uses: ['points.awardTaskCompletion', 'points.reverseTaskAward'], optional: true, reason: '完成家务记积分' },
  ],
  nav: [{ key: 'tasks', label: '任务', glyph: '待', scene: 'schedule', path: '/schedule/tasks', mobileTab: 'schedule' }],
  legacyPaths: [['/tasks', '/schedule/tasks']],
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    // 打勾会改日历上的任务条目、记积分
    routes: [{ prefix: '/tasks', domains: ['tasks', 'calendar', 'points'] }],
    queryKeys: ['tasks'],
    // task-events.ts TaskEvents.onCompleted；智能家居联动在订阅
    emits: ['tasks.completed'],
  },
  actions: [
    {
      id: 'tasks.create',
      label: '加任务',
      keywords: ['待办'],
      deepLink: '/schedule/tasks?create=1',
      // 任务会出现在日历上
      propose: { legacyTool: 'propose_task', actionType: 'task', label: '家庭任务', domains: ['tasks', 'calendar'] },
    },
  ],
  queries: [
    { id: 'tasks.household', label: '家里的任务', server: 'tasks.household', legacyTool: 'get_tasks' },
    { id: 'tasks.member', label: '某个成员的任务', server: 'tasks.member', legacyTool: 'get_member_tasks' },
  ],
  usage: {
    label: '任务',
    activityModules: ['task'],
    tables: [{ label: '任务', table: 'household_tasks', memberColumn: 'createdById', createdColumn: 'createdAt' }],
    uncounted: ['任务完成：只数新建任务；完成 / 认领（household_task_instances.resolvedById）不是新增行，未计入'],
  },
  notifications: [{ key: 'task', label: '任务', icon: '✅' }],
} as const satisfies PluginManifest;
