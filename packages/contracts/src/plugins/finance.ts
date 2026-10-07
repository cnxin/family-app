// 财务（J1.3；Phase K 加周期账单、信用卡）。流水只能冲销不能改；记账提案必须单独确认，不能打包进 propose_plan。
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
  // K3：汇总页「固定支出」里的资产续费月均从资产门面读（docs/architecture.md §9）
  dependsOn: ['assets'],
  attention: {
    label: '财务',
    actionLabel: '看预算',
    // 只有一张卡里混着超预算和要付的周期账单时才用这两项
    listActionLabel: '去财务看看',
    path: '/house/finance',
    order: 7,
    mergedTitle: '{n} 个分类超预算了',
    mixedTitle: '{n} 件财务的事要看',
    kinds: [
      {
        kind: 'budget',
        server: 'finance.budget',
        actionLabel: '看预算',
        capability: 'manage_finance',
        title: '{name}本月预算超了',
      },
      {
        // K3：没开自动记账的周期账单，到期前 3 天起出现；成员也能点「已付」，不设能力门槛
        kind: 'recurring',
        server: 'finance.recurring',
        actionLabel: '去看看',
        path: '/house/finance?view=recurring',
        title: '{name} {soon}该付了',
        mergedTitle: '{n} 笔固定支出该付了',
      },
      {
        // K4：信用卡还款日前 3 天起、还欠着钱时出现（名字里带欠多少）；还款就是转账，点进去直接开转账
        kind: 'credit',
        server: 'finance.credit',
        actionLabel: '去还款',
        path: '/house/finance?create=1&kind=transfer',
        title: '{name} {soon}到还款日',
        mergedTitle: '{n} 张信用卡该还款了',
      },
      {
        // K 收尾：自动记账落失败（账户 / 分类停用等），不再自动重试，等管理员在固定支出里重试或停用；名字里带原因
        kind: 'recurring-failed',
        server: 'finance.recurring-failed',
        actionLabel: '去处理',
        path: '/house/finance?view=recurring',
        capability: 'manage_finance',
        title: '{name}',
        mergedTitle: '{n} 笔自动记账失败了',
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
