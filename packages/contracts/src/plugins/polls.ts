// 投票（J1.2）。
import type { PluginManifest } from './types';

export const pollsManifest = {
  key: 'polls',
  name: '投票',
  glyph: '票',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'polls', label: '投票', glyph: '票', scene: 'schedule', path: '/schedule/polls' }],
  legacyPaths: [['/polls', '/schedule/polls']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'polls' }] } },
  events: {
    // 观影投票结束会回写片单状态
    routes: [{ prefix: '/polls', domains: ['polls', 'media'] }],
    queryKeys: ['polls'],
  },
  attention: {
    label: '投票',
    actionLabel: '去投票',
    listActionLabel: '去投票',
    path: '/schedule/polls',
    order: 5,
    mergedTitle: '{n} 个投票等你',
    kinds: [
      {
        kind: 'vote',
        server: 'polls.vote',
        actionLabel: '去投票',
        path: '/schedule/polls?pollId={id}',
        title: '「{name}」还没投，{soon}截止',
        titleNoDue: '「{name}」还没投',
      },
    ],
  },
  actions: [
    {
      id: 'polls.create',
      label: '发起投票',
      keywords: ['表决'],
      deepLink: '/schedule/polls?create=1',
      propose: { actionType: 'poll', label: '家庭投票' },
    },
  ],
  usage: {
    label: '投票',
    activityModules: ['poll'],
    tables: [
      {
        label: '投票',
        table: 'polls',
        memberColumn: 'createdById',
        createdColumn: 'createdAt',
        where: `"sourceModule" IS DISTINCT FROM 'media'`,
        note: '观影投票除外，已在流水',
      },
      { label: '投票（投票人）', table: 'poll_votes', memberColumn: 'memberId', createdColumn: 'createdAt' },
    ],
  },
  queries: [{ id: 'polls.list', label: '家里的投票', server: 'polls.list', toolName: 'get_polls' }],
  notifications: [{ key: 'poll', label: '投票', icon: '🗳' }],
} as const satisfies PluginManifest;
