import {
  pluginAttention,
  pluginLegacyPaths,
  renderTemplate,
  type AttentionItem,
  type PluginAttention,
  type PluginKey,
} from '@family/contracts';

/**
 * 旧客户端的路径 → 新客户端的路径。后端在通知、日历条目、提醒来源里写的 targetPath
 * 还是旧的一层路径（比如 `/polls?pollId=…`），搬完一页就在这里补一行，查询串原样带过去。
 * 换不出来返回 null：调用方提示一句 MISSING_TARGET，不跳走（旧客户端已在 H1 删除）。
 */
export const MISSING_TARGET = '没找到这条记录对应的页面';

/** 已迁插件的旧路径从 manifest 取（J1），放在原来的位置：前缀匹配取第一条，顺序有意义。 */
function legacyPaths(key: PluginKey): [string, string][] {
  return pluginLegacyPaths(key).map(([from, to]) => [from, to]);
}

const MOVED: [string, string][] = [
  ...legacyPaths('menus'),
  ...legacyPaths('recipes'),
  ...legacyPaths('shopping'),
  ...legacyPaths('inventory'),
  ...legacyPaths('calendar'),
  ...legacyPaths('tasks'),
  ...legacyPaths('reminders'),
  ...legacyPaths('polls'),
  ...legacyPaths('points'),
  ['/members', '/house/members'],
  ...legacyPaths('guests'),
  ...legacyPaths('assets'),
  ...legacyPaths('finance'),
  ...legacyPaths('knowledge'),
  ...legacyPaths('memories'),
  ...legacyPaths('travel'),
  ['/system-backups', '/house/backups'],
  ['/activity', '/life/activity'],
  ['/media/library', '/life/media/library'],
  ['/media/history', '/life/media/history'],
  ['/media/watchlist', '/life/media/watchlist'],
  ['/media/settings', '/life/media/settings'],
  ['/media', '/life/media'],
  ['/profile', '/me/profile'],
  ['/assistant', '/me/assistant'],
  ['/agent-memory', '/me/assistant/memories'],
  ['/notifications', '/schedule/notifications'],
];

/** 已经是新客户端的规范路径（后端逐步改为直接生成新路径），原样放行。 */
const CANONICAL = /^\/(?:eat|schedule|house|life|me)(?:\/|$)|^\/(?:home|settings)$/;

export function toNewRoute(targetPath: string | null | undefined): string | null {
  if (!targetPath) return null;
  const [pathname, search = ''] = targetPath.split('?');
  if (CANONICAL.test(pathname)) return targetPath;
  const hit = MOVED.find(([from]) => pathname === from || pathname.startsWith(`${from}/`));
  if (!hit) return null;
  const rest = pathname.slice(hit[0].length);
  return `${hit[1]}${rest}${search ? `?${search}` : ''}`;
}

/** 已迁插件的留意配置（J1），按域取。 */
export const pluginAttentionOf: ReadonlyMap<string, PluginAttention> = new Map(
  pluginAttention().map(({ key, attention }) => [key, attention]),
);

const HANDWRITTEN_ATTENTION_ROUTES: Partial<Record<AttentionItem['domain'], string>> = {
  backups: '/house/backups', 'smart-home': '/house/smart-home',
};

export const attentionRoutes = {
  ...HANDWRITTEN_ATTENTION_ROUTES,
  ...Object.fromEntries([...pluginAttentionOf].map(([key, attention]) => [key, attention.path])),
} as Record<AttentionItem['domain'], string>;

/** manifest 的落点模板：占位（`{id}` 实体、`{dueOn}` 日期）都有值才用，否则回到域的默认落点。 */
function pluginAttentionPath(attention: PluginAttention, item: { kind: string; kinds?: string[]; dueOn?: string; entity?: { id: string } }) {
  if ((item.kinds?.length ?? 0) > 1) return attention.path;
  const template = attention.kinds.find((kind) => kind.kind === item.kind)?.path;
  if (!template) return attention.path;
  const values: Record<string, string | undefined> = {
    id: item.entity && encodeURIComponent(item.entity.id),
    dueOn: item.dueOn && encodeURIComponent(item.dueOn),
  };
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  return names.every((name) => values[name]) ? renderTemplate(template, values) : attention.path;
}


/** F5「需要留意」卡片的单步直达路径，所有文案层路径都集中从这里生成。 */
export function attentionPath(item: {
  domain: AttentionItem['domain'];
  kind: string;
  kinds?: string[];
  dueOn?: string;
  entity?: { id: string };
}): string {
  const plugin = pluginAttentionOf.get(item.domain);
  if (plugin) return pluginAttentionPath(plugin, item);
  if ((item.kinds?.length ?? 0) > 1) return attentionRoutes[item.domain];
  if (item.domain === 'smart-home') {
    if (item.kind === 'filter' && item.entity) return `${attentionRoutes['smart-home']}?device=${encodeURIComponent(item.entity.id)}`;
    if (item.kind === 'laundry' && item.entity) return `/schedule/tasks?task=${encodeURIComponent(item.entity.id)}`;
    if (item.kind === 'offline') return `${attentionRoutes['smart-home']}/settings`;
  }
  return attentionRoutes[item.domain];
}
