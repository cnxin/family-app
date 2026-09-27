/**
 * 旧客户端的路径 → 新客户端的路径。后端在通知、日历条目、提醒来源里写的 targetPath
 * 还是旧的一层路径（比如 `/polls?pollId=…`），搬完一页就在这里补一行，查询串原样带过去。
 * 没搬的返回 null，调用方自己决定去旧版打开。
 */
const MOVED: [string, string][] = [
  ['/order', '/eat/order'],
  ['/kitchen', '/eat/kitchen'],
  ['/recipes', '/eat/recipes'],
  ['/shopping', '/house/shopping'],
  ['/supplies', '/house/shopping'],
  ['/inventory', '/house/inventory'],
  ['/calendar', '/schedule/calendar'],
  ['/tasks', '/schedule/tasks'],
  ['/reminders', '/schedule/reminders'],
  ['/polls', '/schedule/polls'],
  ['/points', '/house/points'],
  ['/members', '/house/members'],
  ['/guests', '/house/guests'],
  ['/assets', '/house/assets'],
  ['/finance', '/house/finance'],
  ['/knowledge', '/life/knowledge'],
  ['/memories', '/life/memories'],
  ['/travel', '/life/travel'],
  ['/system-backups', '/house/backups'],
  ['/activity', '/life/activity'],
  ['/media/library', '/life/media/library'],
  ['/media/history', '/life/media/history'],
  ['/media/watchlist', '/life/media/watchlist'],
  ['/media/settings', '/life/media/settings'],
  ['/media', '/life/media'],
  ['/home-assets', '/house/assets'],
  ['/asset', '/house/assets'],
  ['/profile', '/me/profile'],
  ['/assistant', '/me/assistant'],
  ['/agent-memory', '/me/assistant/memories'],
  ['/notifications', '/schedule/notifications'],
];

export function toNewRoute(targetPath: string | null | undefined): string | null {
  if (!targetPath) return null;
  const [pathname, search = ''] = targetPath.split('?');
  const hit = MOVED.find(([from]) => pathname === from || pathname.startsWith(`${from}/`));
  if (!hit) return null;
  const rest = pathname.slice(hit[0].length);
  return `${hit[1]}${rest}${search ? `?${search}` : ''}`;
}

export const attentionRoutes = {
  assets: '/house/assets', guests: '/house/guests', travel: '/life/travel', inventory: '/house/inventory', polls: '/schedule/polls', points: '/house/points', finance: '/house/finance', backups: '/house/backups', 'smart-home': '/home',
} as const;


/** F5「需要留意」卡片的单步直达路径，所有文案层路径都集中从这里生成。 */
export function attentionPath(item: {
  domain: keyof typeof attentionRoutes;
  kind: string;
  kinds?: string[];
  dueOn?: string;
  entity?: { id: string };
}): string {
  if ((item.kinds?.length ?? 0) > 1) return attentionRoutes[item.domain];
  if (item.domain === 'assets' && item.entity) return `${attentionRoutes.assets}/${encodeURIComponent(item.entity.id)}`;
  if (item.domain === 'travel' && item.entity) return `${attentionRoutes.travel}/${encodeURIComponent(item.entity.id)}`;
  if (item.domain === 'polls' && item.entity) return `${attentionRoutes.polls}?pollId=${encodeURIComponent(item.entity.id)}`;
  if (item.domain === 'points' && item.entity) return `${attentionRoutes.points}?redemptionId=${encodeURIComponent(item.entity.id)}`;
  // 来访记录没有餐次，默认晚餐；点菜页读到 date 后会把参数抹掉。
  if (item.domain === 'guests' && item.kind === 'menu' && item.dueOn) {
    return `/eat/order?date=${encodeURIComponent(item.dueOn)}&mealType=dinner`;
  }
  return attentionRoutes[item.domain];
}
