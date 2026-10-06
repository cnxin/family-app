import { renderTemplate, type AttentionItem, type PluginAttention } from '@family/contracts';
import { daysBetween } from '@family/shared';
import { attentionPath, declaredAttention } from './routes';

export type AttentionCopy = {
  domainLabel: string;
  title: string;
  timeText: string;
  actionLabel: string;
  path: string;
};

// 每个留意域、每种事的文案都来自声明：插件的在 manifest 的 attention，内核的（备份）在 CORE_ATTENTION（J1.7 起没有手写表）。

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
  const attention = declaredAttention(item.domain);
  const name = item.entity?.name ?? attention.label;
  const when = timePhrase(item, today);
  if (item.overdue) return `${name}${when}`;
  const soon = item.dueOn ? `${when}` : '';
  const kind = declaredKind(attention, item);
  return renderTemplate(item.dueOn ? kind.title : (kind.titleNoDue ?? kind.title), { name, soon });
}

/** 留意种类必须在声明里（今天页注册的种类与声明一致由 check-plugins 断言），对不上直接报错，不再有兜底文案。 */
function declaredKind(attention: PluginAttention, item: AttentionItem) {
  const kind = attention.kinds.find((one) => one.kind === item.kind);
  if (!kind) throw new Error(`留意 ${item.domain}/${item.kind} 没有声明`);
  return kind;
}

/** 多件：每个域、每种事写成家里人会说的话。overdue 表示其中有逾期的，不是全部。 */
function mergedTitle(item: AttentionItem): string {
  const n = item.count;
  const mixed = item.kinds.length > 1;
  const attention = declaredAttention(item.domain);
  const template = mixed
    ? (attention.mixedTitle ?? attention.mergedTitle)
    : item.overdue && attention.mergedOverdueTitle
      ? attention.mergedOverdueTitle
      : (declaredKind(attention, item).mergedTitle ?? attention.mergedTitle);
  return renderTemplate(template, { n });
}

export function attentionCopy(item: AttentionItem, today = item.dueOn ?? ''): AttentionCopy {
  const attention = declaredAttention(item.domain);
  const mixed = item.kinds.length > 1;
  return {
    domainLabel: attention.label,
    title: item.count > 1 ? mergedTitle(item) : singleTitle(item, today),
    timeText: timePhrase(item, today),
    actionLabel: mixed ? attention.listActionLabel : declaredKind(attention, item).actionLabel,
    path: attentionPath(item),
  };
}
