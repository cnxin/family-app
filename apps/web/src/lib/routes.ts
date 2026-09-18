/**
 * 旧客户端的路径 → 新客户端的路径。后端在通知、日历条目、提醒来源里写的 targetPath
 * 还是旧的一层路径（比如 `/polls?pollId=…`），搬完一页就在这里补一行，查询串原样带过去。
 * 没搬的返回 null，调用方自己决定去旧版打开。
 */
const MOVED: [string, string][] = [
  ['/order', '/eat/order'],
  ['/kitchen', '/eat/kitchen'],
  ['/recipes', '/eat/recipes'],
  ['/shopping', '/eat/shopping'],
  ['/supplies', '/eat/shopping'],
  ['/calendar', '/schedule/calendar'],
  ['/tasks', '/schedule/tasks'],
  ['/reminders', '/schedule/reminders'],
  ['/polls', '/schedule/polls'],
  ['/points', '/house/points'],
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
