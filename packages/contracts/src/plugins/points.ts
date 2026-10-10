// 积分（J1.2）。任务打勾记积分是任务 → 积分的事务内调用，归 J1b。
import type { PluginManifest } from './types';

export const pointsManifest = {
  key: 'points',
  name: '积分',
  glyph: '分',
  manifestVersion: 1,
  tier: 'shelf',
  // J1b：任务打勾记积分 / 取消打勾冲销，订阅任务的事务内钩子（同一事务）
  hooks: ['tasks.completed', 'tasks.uncompleted'],
  nav: [{ key: 'points', label: '积分', glyph: '分', scene: 'house', path: '/house/points' }],
  legacyPaths: [['/points', '/house/points']],
  module: {
    overridable: true,
    hasData: { kind: 'tables', tables: [{ table: 'points_ledger' }, { table: 'rewards' }] },
  },
  events: {
    routes: [{ prefix: '/points' }, { prefix: '/rewards' }, { prefix: '/reward-redemptions' }],
    queryKeys: ['rewards', 'reward-redemptions', 'points-accounts', 'points-ledger'],
  },
  attention: {
    label: '积分',
    actionLabel: '去审批',
    listActionLabel: '去审批',
    path: '/house/points',
    order: 6,
    mergedTitle: '{n} 个兑换等你审批',
    kinds: [
      {
        kind: 'redemption',
        server: 'points.redemption',
        actionLabel: '去审批',
        path: '/house/points?redemptionId={id}',
        capability: 'manage_points',
        title: '{name}的兑换等你审批',
      },
    ],
  },
  queries: [
    { id: 'points.summary', label: '积分余额与待审批的兑换', server: 'points.summary', toolName: 'get_points_summary' },
  ],
  usage: { label: '积分', activityModules: ['points'] },
  notifications: [{ key: 'points', label: '积分', icon: '🎁' }],
  capabilities: [{ key: 'manage_points', roles: ['owner', 'admin'] }],
} as const satisfies PluginManifest;
