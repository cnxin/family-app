import { renderTemplate, type AttentionItem } from '@family/contracts';
import { daysBetween } from '@family/shared';
import { attentionPath, pluginAttentionOf } from './routes';

export type AttentionCopy = {
  domainLabel: string;
  title: string;
  timeText: string;
  actionLabel: string;
  path: string;
};

const HANDWRITTEN_LABELS: Partial<Record<AttentionItem['domain'], string>> = {
  assets: '资产',
  guests: '访客',
  inventory: '库存',
  finance: '财务',
  backups: '备份',
  'smart-home': '智能家居',
};

const HANDWRITTEN_ACTIONS: Partial<Record<AttentionItem['domain'], string>> = {
  assets: '看这件资产',
  guests: '去点菜',
  inventory: '看库存',
  finance: '看预算',
  backups: '看备份',
  'smart-home': '去看看',
};

const kindActions: Partial<Record<string, string>> = {
  'meal-request': '去处理',
  menu: '去点菜',
  budget: '看预算',
  backup: '看备份',
  filter: '看滤芯',
  laundry: '去晾衣服',
  offline: '看连接',
};

const HANDWRITTEN_LIST_ACTIONS: Partial<Record<AttentionItem['domain'], string>> = {
  assets: '看资产',
  guests: '去处理',
  inventory: '看库存',
  finance: '看预算',
  backups: '看备份',
  'smart-home': '去看看',
};

// 已迁插件的域名、默认按钮、列表按钮由 manifest 生成（J1）
const fromPlugins = (pick: (attention: NonNullable<ReturnType<typeof pluginAttentionOf.get>>) => string) =>
  Object.fromEntries([...pluginAttentionOf].map(([key, attention]) => [key, pick(attention)]));
const labels = { ...HANDWRITTEN_LABELS, ...fromPlugins((one) => one.label) } as Record<AttentionItem['domain'], string>;
const actions = { ...HANDWRITTEN_ACTIONS, ...fromPlugins((one) => one.actionLabel) } as Record<AttentionItem['domain'], string>;
const listActions = { ...HANDWRITTEN_LIST_ACTIONS, ...fromPlugins((one) => one.listActionLabel) } as Record<AttentionItem['domain'], string>;

function timePhrase(item: AttentionItem, today: string) {
  if (item.overdue) {
    if (!item.dueOn) return '已逾期';
    return `已逾期 ${Math.max(1, daysBetween(item.dueOn, today))} 天`;
  }
  if (!item.dueOn) return '待处理';
  const days = Math.max(0, daysBetween(today, item.dueOn));
  return days === 0 ? '今天' : `${days} 天后`;
}

/**
 * 单件：说出是哪一件、什么时候、要做什么。逾期统一写「已逾期 N 天」。
 * 「净水器滤芯 3 天后该换了」是 ia-plan F5b 的原话，维护沿用。
 */
function singleTitle(item: AttentionItem, today: string) {
  const name = item.entity?.name ?? labels[item.domain];
  const when = timePhrase(item, today);
  if (item.overdue) return `${name}${when}`;
  const soon = item.dueOn ? `${when}` : '';
  const kind = pluginAttentionOf.get(item.domain)?.kinds.find((one) => one.kind === item.kind);
  if (kind) return renderTemplate(item.dueOn ? kind.title : (kind.titleNoDue ?? kind.title), { name, soon });
  switch (item.kind) {
    case 'maintenance':
      return `${name} ${soon}该换了`;
    case 'renewal':
      return `${name} ${soon}该续费了`;
    case 'warranty':
      return `${name} ${soon}保修到期`;
    case 'menu':
      return `${name}（${soon || '快到了'}）还没定菜`;
    case 'meal-request':
      return `${name}的点菜请求等你处理`;
    case 'expiry':
      return `${name} ${soon}过期`;
    case 'budget':
      return `${name}本月预算超了`;
    case 'backup':
      return '备份需要看一下';
    // 智能家居（H3 E5）：滤芯的 entity 是设备，晾衣服的是家务，连不上的是 Home Assistant 本身
    case 'filter':
      return `${name}的滤芯快用完了`;
    case 'laundry':
      return '衣服好了两个多小时，还没晾';
    case 'offline':
      return 'Home Assistant 连不上一个多小时了';
    default:
      return item.dueOn ? `${name} ${soon}需要处理` : `${name}需要处理`;
  }
}

/** 多件：每个域、每种事写成家里人会说的话。overdue 表示其中有逾期的，不是全部。 */
function mergedTitle(item: AttentionItem): string {
  const n = item.count;
  const mixed = item.kinds.length > 1;
  const plugin = pluginAttentionOf.get(item.domain);
  if (plugin) {
    const kind = plugin.kinds.find((one) => one.kind === item.kind);
    const template = mixed
      ? (plugin.mixedTitle ?? plugin.mergedTitle)
      : item.overdue && plugin.mergedOverdueTitle
        ? plugin.mergedOverdueTitle
        : (kind?.mergedTitle ?? plugin.mergedTitle);
    return renderTemplate(template, { n });
  }
  switch (item.domain) {
    case 'assets':
      if (mixed) return `${n} 件资产要处理`;
      if (item.kind === 'renewal') return `${n} 项订阅该续费了`;
      if (item.kind === 'warranty') return `${n} 件资产保修快到期`;
      return `${n} 件资产该保养了`;
    case 'guests':
      if (mixed) return `${n} 件访客的事要处理`;
      return item.kind === 'meal-request' ? `${n} 条访客点菜等你处理` : `本周有 ${n} 场来访要准备`;
    case 'inventory':
      return item.overdue ? `${n} 样快过期，有的已经过期了` : `${n} 样快过期`;
    case 'finance':
      return `${n} 个分类超预算了`;
    case 'backups':
      return `备份有 ${n} 件事要看一下`;
    case 'smart-home':
      return `智能家居有 ${n} 件事要看一下`;
    default:
      return `${n} 件${labels[item.domain] ?? String(item.domain)}要处理`;
  }
}

export function attentionCopy(item: AttentionItem, today = item.dueOn ?? ''): AttentionCopy {
  const mixed = item.kinds.length > 1;
  return {
    domainLabel: labels[item.domain],
    title: item.count > 1 ? mergedTitle(item) : singleTitle(item, today),
    timeText: timePhrase(item, today),
    actionLabel: mixed
      ? listActions[item.domain]
      : (pluginAttentionOf.get(item.domain)?.kinds.find((one) => one.kind === item.kind)?.actionLabel
        ?? kindActions[item.kind]
        ?? actions[item.domain]),
    path: attentionPath(item),
  };
}
