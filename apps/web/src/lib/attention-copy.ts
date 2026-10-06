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
  backups: '备份',
};

const HANDWRITTEN_ACTIONS: Partial<Record<AttentionItem['domain'], string>> = {
  backups: '看备份',
};

const kindActions: Partial<Record<string, string>> = {
  backup: '看备份',
};

const HANDWRITTEN_LIST_ACTIONS: Partial<Record<AttentionItem['domain'], string>> = {
  backups: '看备份',
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
    case 'backup':
      return '备份需要看一下';
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
    case 'backups':
      return `备份有 ${n} 件事要看一下`;
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
