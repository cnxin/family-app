import type { AttentionItem } from '@family/contracts';
import { daysBetween } from '@family/shared';
import { attentionPath } from './routes';

export type AttentionCopy = {
  domainLabel: string;
  title: string;
  timeText: string;
  actionLabel: string;
  path: string;
};

const labels: Record<AttentionItem['domain'], string> = {
  assets: '资产',
  guests: '访客',
  travel: '出行',
  inventory: '库存',
  polls: '投票',
  points: '积分',
  finance: '财务',
  backups: '备份',
  'smart-home': '智能家居',
};

const verbs: Record<string, string> = {
  maintenance: '该换了',
  renewal: '该续费了',
  warranty: '保修到期',
  menu: '还没定菜',
  'meal-request': '还没处理',
  checklist: '还没准备好',
  expiry: '快过期了',
  vote: '还没投',
  redemption: '还没审批',
  budget: '预算超了',
  backup: '需要看一下',
};

const actions: Record<AttentionItem['domain'], string> = {
  assets: '看这件资产',
  guests: '去点菜',
  travel: '看清单',
  inventory: '看库存',
  polls: '去投票',
  points: '去审批',
  finance: '看预算',
  backups: '看备份',
  'smart-home': '去看看',
};

const kindActions: Partial<Record<string, string>> = {
  'meal-request': '去处理',
  menu: '去点菜',
  checklist: '看清单',
  vote: '去投票',
  redemption: '去审批',
  budget: '看预算',
  backup: '看备份',
};

const listActions: Record<AttentionItem['domain'], string> = {
  assets: '看资产',
  guests: '去处理',
  travel: '看行程',
  inventory: '看库存',
  polls: '去投票',
  points: '去审批',
  finance: '看预算',
  backups: '看备份',
  'smart-home': '去看看',
};

function timePhrase(item: AttentionItem, today: string) {
  if (item.overdue) {
    if (!item.dueOn) return '已逾期';
    return `已逾期 ${Math.max(1, daysBetween(item.dueOn, today))} 天`;
  }
  if (!item.dueOn) return '待处理';
  const days = Math.max(0, daysBetween(today, item.dueOn));
  return days === 0 ? '今天' : `${days} 天后`;
}

function singleTitle(item: AttentionItem, today: string) {
  const name = item.entity?.name ?? labels[item.domain];
  const when = timePhrase(item, today);
  if (item.overdue) return `${name}${when}`;
  if (!item.dueOn) return `${name}${verbs[item.kind] ?? '需要处理'}`;
  return `${name} ${when}${verbs[item.kind] ?? '需要处理'}`;
}

function mergedTitle(item: AttentionItem) {
  const label = labels[item.domain];
  if (item.overdue) return `${item.count} 件${label}已逾期`;
  if (item.dueOn) return `${item.count} 件${label}快到期`;
  return `${item.count} 件${label}待处理`;
}

export function attentionCopy(item: AttentionItem, today = item.dueOn ?? ''): AttentionCopy {
  const mixed = item.kinds.length > 1;
  return {
    domainLabel: labels[item.domain],
    title: item.count > 1 ? mergedTitle(item) : singleTitle(item, today),
    timeText: timePhrase(item, today),
    actionLabel: mixed ? listActions[item.domain] : (kindActions[item.kind] ?? actions[item.domain]),
    path: attentionPath(item),
  };
}
