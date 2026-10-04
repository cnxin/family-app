// J0 草稿：任务（家务）。每个字段注明现在登记在哪；未接线，J1 才改成由它生成。
import type { PluginManifest } from './types';

export const tasksManifest = {
  key: 'tasks',
  name: '任务',
  glyph: '待',
  manifestVersion: 1,
  tier: 'core',
  requires: [
    // tasks.module.ts 在打勾的同一个事务里调 PointsService.awardTaskCompletion / reverseTaskAward。
    // 事务内同步调用，不能直接改成异步事件；J1 需要「带事务的跨插件门面」，或积分改为订阅 tasks.completed 并自己补偿。
    { plugin: 'points', via: 'contract', uses: ['points.awardTaskCompletion', 'points.reverseTaskAward'], optional: true, reason: '完成家务记积分' },
  ],
  nav: [{ key: 'tasks', label: '任务', glyph: '待', scene: 'schedule', path: '/schedule/tasks', tier: 'core', mobileTab: 'schedule' }],
  legacyPaths: [['/tasks', '/schedule/tasks']],
  module: { overridable: false, hasData: { kind: 'always' } },
  events: {
    routes: [{ prefix: '/tasks', domains: ['tasks', 'calendar', 'points'] }],
    queryKeys: ['tasks'],
    // task-events.ts TaskEvents.onCompleted；智能家居 E4 联动在订阅
    emits: ['tasks.completed'],
  },
  actions: [
    {
      id: 'tasks.create', // actions.ts 'task'
      label: '加任务',
      keywords: ['待办'],
      deepLink: '/schedule/tasks?create=1',
      slots: { title: 'text', date: 'date?', assignee: 'member?' },
      templates: ['{date}{assignee}{title}', '加个任务{title}', '提醒{assignee}{date}{title}'],
      propose: { legacyTool: 'propose_task', actionType: 'task' },
    },
  ],
  queries: [
    {
      id: 'tasks.household',
      label: '家里的任务',
      templates: ['{date}有什么家务', '{date}全家要干什么'],
      slots: { date: 'date?' },
      server: 'tasks.household',
      legacyTool: 'get_tasks',
    },
    {
      id: 'tasks.mine',
      label: '我的任务',
      templates: ['我{date}有什么任务', '{member}{date}要干什么'],
      slots: { date: 'date?', member: 'member?' },
      server: 'tasks.member',
      legacyTool: 'get_member_tasks',
    },
  ],
  usage: {
    label: '任务',
    activityModules: ['task'],
    tables: [{ label: '任务', table: 'household_tasks', memberColumn: 'createdById', createdColumn: 'createdAt' }],
    uncounted: ['任务完成：只数新建任务；完成 / 认领（household_task_instances.resolvedById）不是新增行，未计入'],
  },
  notifications: [{ key: 'task', label: '任务', icon: '✅' }], // web notification-meta.ts
} as const satisfies PluginManifest;
