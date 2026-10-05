// 财务（J1.3）。流水只能冲销不能改；记账提案必须单独确认，不能打包进 propose_plan。
// 权限口径（architecture §8.6 第 3 条）：成员能看流水、记账；账户、分类、预算、冲销只有管理员（manage_finance）。
import type { PluginManifest } from './types';

export const financeManifest = {
  key: 'finance',
  name: '财务',
  glyph: '账',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'finance', label: '财务', glyph: '账', scene: 'house', path: '/house/finance' }],
  legacyPaths: [['/finance', '/house/finance']],
  module: {
    overridable: true,
    hasData: {
      kind: 'tables',
      tables: [{ table: 'finance_accounts' }, { table: 'finance_transactions' }, { table: 'finance_budgets' }],
    },
  },
  events: {
    routes: [{ prefix: '/finance' }],
    queryKeys: ['finance'],
  },
  attention: {
    label: '财务',
    actionLabel: '看预算',
    listActionLabel: '看预算',
    path: '/house/finance',
    order: 7,
    mergedTitle: '{n} 个分类超预算了',
    kinds: [
      {
        kind: 'budget',
        server: 'finance.budget',
        actionLabel: '看预算',
        capability: 'manage_finance',
        title: '{name}本月预算超了',
      },
    ],
  },
  actions: [
    {
      id: 'finance.record-expense',
      label: '记一笔支出',
      keywords: ['记账', '花钱'],
      deepLink: '/house/finance?create=1&kind=expense',
      // 一个提案工具同时管收入和支出
      propose: { legacyTool: 'propose_finance_transaction', actionType: 'finance', label: '家庭记账', grouped: false },
      capability: 'record_finance',
    },
    {
      id: 'finance.record-income',
      label: '记一笔收入',
      keywords: ['进账'],
      deepLink: '/house/finance?create=1&kind=income',
      capability: 'record_finance',
    },
  ],
  queries: [
    { id: 'finance.summary', label: '本月家庭财务', server: 'finance.summary', legacyTool: 'get_finance_summary', capability: 'view_finance' },
  ],
  usage: { label: '财务', activityModules: ['finance'] },
  capabilities: [
    { key: 'view_finance', roles: ['owner', 'admin', 'member'] },
    { key: 'record_finance', roles: ['owner', 'admin', 'member'] },
    { key: 'manage_finance', roles: ['owner', 'admin'] },
  ],
} as const satisfies PluginManifest;
