import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { KERNEL_DOMAIN_KEYS, PLUGIN_KEYS, pluginEventExempt, pluginEventRoutes } from './plugins';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/events/（H2a）。/events 只推「哪个域变了」，不推数据；客户端收到后让
// 对应查询失效、自己重取。

/**
 * 域 key 的唯一来源在 plugins/keys.ts：18 个插件 + 内核域。
 * 已迁到 manifest 的插件，写端点映射由 manifest 生成（见 EVENT_ROUTES 末尾）；还没迁的在下面手写。
 */
export const DOMAIN_KEYS = [...PLUGIN_KEYS, ...KERNEL_DOMAIN_KEYS] as const;
export const domainKey = z.enum(DOMAIN_KEYS);
export type DomainKey = z.infer<typeof domainKey>;

/** 连接建立后第一条。 */
export const eventsHelloSchema = z.object({ serverTime: isoDateTime, connectionId: z.string() });
export type EventsHello = z.infer<typeof eventsHelloSchema>;

/** 某个家庭的这些域有写入。actor 是发起写入的成员；后台任务、访客、webhook 触发时没有。 */
export const eventsChangedSchema = z.object({
  domains: z.array(domainKey).min(1),
  at: isoDateTime,
  actor: uuid.optional(),
});
export type EventsChanged = z.infer<typeof eventsChangedSchema>;

/** 心跳间隔：连接空闲时每 20 秒一条 `heartbeat`（内容为空），客户端据此判断连接是否还活着。 */
export const EVENTS_HEARTBEAT_MS = 20_000;
/** 每个家庭最多同时 20 条连接，超了拒绝新连接。 */
export const EVENTS_MAX_CONNECTIONS_PER_HOUSEHOLD = 20;

export const events = {
  stream: defineEndpoint({
    method: 'GET',
    path: '/events',
    summary: 'SSE 事件流：hello → changed / heartbeat（@Res() 直接写流，契约为 undefined）',
    response: z.undefined(),
  }),
};

// ---- 写端点 → 域 ------------------------------------------------------------------------------

/**
 * 一条映射：路由模板前缀（按段匹配，最长前缀优先）→ 这次写入影响到的域。
 * - 默认由全局拦截器在登录用户的写请求成功（2xx）后发 `changed`；
 * - `emit: 'explicit'`：请求里没有登录用户（访客公开页、webhook、内部通道），家庭由业务服务
 *   自己确定并显式发，拦截器跳过。
 */
export interface EventRoute {
  prefix: string;
  domains: readonly DomainKey[];
  emit?: 'explicit';
}

/** 小管家确认提案会按提案类型写各个域。 */
const PROPOSAL_DOMAINS: readonly DomainKey[] = [
  'assistant', 'tasks', 'reminders', 'polls', 'shopping', 'menus', 'finance', 'calendar',
];

const HANDWRITTEN_EVENT_ROUTES: readonly EventRoute[] = [
  { prefix: '/agent', domains: ['assistant'] },
  { prefix: '/agent/proposals', domains: PROPOSAL_DOMAINS },
  { prefix: '/agent/proposal-groups', domains: PROPOSAL_DOMAINS },
  { prefix: '/internal/agent/channels/:channelId/messages', domains: ['assistant'], emit: 'explicit' },
  { prefix: '/internal/agent/mcp', domains: ['assistant'], emit: 'explicit' },

  { prefix: '/assets', domains: ['assets', 'reminders', 'calendar', 'locations'] },
  { prefix: '/assets/:id/location', domains: ['assets', 'locations'] },
  { prefix: '/locations', domains: ['locations', 'inventory', 'assets'] },
  { prefix: '/map', domains: ['locations'] },
  { prefix: '/asset-documents', domains: ['assets'] },
  { prefix: '/maintenance-plans', domains: ['assets', 'reminders', 'calendar', 'inventory'] },
  { prefix: '/maintenance-plans/:id/shopping-items', domains: ['assets', 'shopping'] },
  { prefix: '/maintenance-consumables', domains: ['assets', 'inventory'] },

  { prefix: '/auth/invitations/redeem', domains: ['members'], emit: 'explicit' },
  { prefix: '/household', domains: ['members'] },
  { prefix: '/members/me/preferences', domains: ['members'] },
  { prefix: '/members/:memberId/dish-skills', domains: ['recipes'] },
  { prefix: '/member-dish-skills', domains: ['recipes'] },
  { prefix: '/households/me', domains: ['household'] },

  { prefix: '/guests', domains: ['guests'] },
  { prefix: '/visits', domains: ['guests', 'calendar', 'menus'] },
  { prefix: '/guest-wifi-profiles', domains: ['guests'] },
  { prefix: '/guest-meal-requests', domains: ['guests', 'menus'] },
  { prefix: '/guest-invitations', domains: ['guests'] },
  { prefix: '/guest-invitations/:token/response', domains: ['guests'], emit: 'explicit' },
  { prefix: '/guest-invitations/:token/meal-requests', domains: ['guests'], emit: 'explicit' },
  { prefix: '/guest-invitations/:token/meal-options', domains: ['guests'], emit: 'explicit' },
  { prefix: '/guest-invitations/:token/movie-polls', domains: ['guests', 'media', 'polls'], emit: 'explicit' },

  { prefix: '/media', domains: ['media'] },
  { prefix: '/media/webhooks', domains: ['media'], emit: 'explicit' },

  { prefix: '/menus', domains: ['menus'] },
  { prefix: '/menus/:id/confirm-consumption', domains: ['menus', 'inventory'] },
  { prefix: '/menu-items', domains: ['menus'] },
  { prefix: '/shopping-list', domains: ['shopping'] },
  { prefix: '/shopping-items', domains: ['shopping', 'inventory'] },
  { prefix: '/shopping-items/:id/confirm-stock', domains: ['shopping', 'inventory', 'locations'] },
  { prefix: '/dishes', domains: ['recipes'] },
  { prefix: '/recipe-variants', domains: ['recipes'] },

  { prefix: '/notifications', domains: ['notifications'] },
  { prefix: '/notification-channels', domains: ['notifications'] },
  { prefix: '/notification-deliveries', domains: ['notifications'] },

  { prefix: '/tasks', domains: ['tasks', 'calendar', 'points'] },
  { prefix: '/calendar-events', domains: ['calendar'] },
  { prefix: '/reminders', domains: ['reminders', 'calendar'] },
  { prefix: '/polls', domains: ['polls', 'media'] },
  { prefix: '/points', domains: ['points'] },
  { prefix: '/rewards', domains: ['points'] },
  { prefix: '/reward-redemptions', domains: ['points'] },
  { prefix: '/finance', domains: ['finance'] },

  { prefix: '/inventory-items', domains: ['inventory', 'shopping', 'locations'] },
  { prefix: '/inventory-batches', domains: ['inventory', 'locations'] },
  { prefix: '/inventory-transactions', domains: ['inventory'] },

  { prefix: '/travel-plans', domains: ['travel', 'calendar', 'reminders'] },
  { prefix: '/travel-templates', domains: ['travel'] },

  { prefix: '/smart-home', domains: ['smart-home'] },
  { prefix: '/smart-home/webhook', domains: ['smart-home'], emit: 'explicit' },

  { prefix: '/system/backups', domains: ['backups'] },
  { prefix: '/system/modules', domains: ['modules'] },
];

/** 手写的 + 已迁插件 manifest 生成的。域名是否合法由 scripts/check-plugins.mjs 断言。 */
export const EVENT_ROUTES: readonly EventRoute[] = [
  ...HANDWRITTEN_EVENT_ROUTES,
  ...(pluginEventRoutes() as readonly EventRoute[]),
];

/** 显式豁免：写入不改变任何家庭共享的数据，或事件由别处统一发。每条都要写原因。 */
const HANDWRITTEN_EVENT_ROUTE_EXEMPT: readonly { prefix: string; reason: string }[] = [
  { prefix: '/auth/login', reason: '登录只建本人会话' },
  { prefix: '/auth/refresh', reason: '续期只换令牌' },
  { prefix: '/auth/logout', reason: '退出只吊销本人会话' },
  { prefix: '/auth/invitations/preview', reason: '只读预览' },
  { prefix: '/auth/setup/bootstrap', reason: '首次初始化时还没有任何家里人连着' },
  { prefix: '/accounts/me/password', reason: '只改本人密码' },
  { prefix: '/internal/agent/channels/pair', reason: '渠道配对只影响绑定，管理员设置弹窗打开时重读' },
  { prefix: '/upload', reason: '只存文件，挂到哪条记录由后续写入决定并发事件' },
];

export const EVENT_ROUTE_EXEMPT: readonly { prefix: string; reason: string }[] = [
  ...HANDWRITTEN_EVENT_ROUTE_EXEMPT,
  ...pluginEventExempt(),
];

function segments(path: string) {
  return path.split('/').filter(Boolean);
}

function matches(prefix: string, path: string) {
  const want = segments(prefix);
  const have = segments(path);
  return want.length <= have.length && want.every((segment, index) => segment === have[index]);
}

/**
 * 按路由模板（如 `/assets/:id/renew`）查映射：最长前缀优先；豁免优先于映射。
 * 返回 null 表示没登记——CI 的 check-event-routes 不允许出现。
 */
export function eventRouteFor(path: string): EventRoute | { exempt: string } | null {
  const exempt = EVENT_ROUTE_EXEMPT.find((entry) => matches(entry.prefix, path));
  if (exempt) return { exempt: exempt.reason };
  let best: EventRoute | null = null;
  for (const route of EVENT_ROUTES) {
    if (matches(route.prefix, path) && (!best || segments(route.prefix).length > segments(best.prefix).length)) {
      best = route;
    }
  }
  return best;
}
