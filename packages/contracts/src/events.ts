import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { KERNEL_DOMAIN_KEYS, PLUGIN_KEYS, pluginEventExempt, pluginEventRoutes, pluginProposalDomains } from './plugins';
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

/**
 * J4.4 小管家 run 的流式事件。SSE 事件名固定为 `agent.run`（照 H2 的命名：事件名是类型，id 在 payload 里），
 * 只推给发起这次 run 的成员的连接。seq 在一次 run 里从 1 递增，最后一条总是 done（客户端收到后再拉一次会话详情对齐）。
 * - 「小管家自带」（native）推全过程：text_delta / tool_call / tool_result / proposal / usage / error / done；
 * - Hermes、本地确定性助理只在结束时推一条 done；
 * - payload 只有增量与状态：正文增量、工具名、提案 id、错误代码。工具参数与工具结果不推（在会话详情里按权限取）。
 */
export const AGENT_RUN_EVENT = 'agent.run';
const agentRunEventBase = { runId: uuid, conversationId: uuid, seq: z.number().int().min(1) };
export const agentRunStreamEventSchema = z.discriminatedUnion('type', [
  /** 模型正文的一段增量，按 seq 拼起来。落库的回答是最后一步的正文（之前步骤若有过渡语也会推，以 done 后的会话详情为准）。 */
  z.object({ ...agentRunEventBase, type: z.literal('text_delta'), text: z.string() }),
  z.object({ ...agentRunEventBase, type: z.literal('tool_call'), toolCallId: z.string(), toolName: z.string() }),
  z.object({
    ...agentRunEventBase,
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    toolName: z.string(),
    ok: z.boolean(),
    /** 工具没成功时的代码（tool_not_allowed / tool_failed / invalid_arguments / unknown_tool）。 */
    errorCode: z.string().nullable(),
  }),
  /** 生成了一条待确认的提案（propose_plan 时是提案组 id）；卡片内容从会话详情取。 */
  z.object({ ...agentRunEventBase, type: z.literal('proposal'), toolCallId: z.string(), toolName: z.string(), proposalId: uuid }),
  z.object({
    ...agentRunEventBase,
    type: z.literal('usage'),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
  }),
  /** native 循环停下的原因（超步数、超时、模型不可用、被取消……）；后面还会跟一条 done（failed，取消时 cancelled）。 */
  z.object({ ...agentRunEventBase, type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({
    ...agentRunEventBase,
    type: z.literal('done'),
    status: z.enum(['completed', 'failed', 'cancelled']),
    errorCode: z.string().nullable(),
  }),
]);
export type AgentRunStreamEvent = z.infer<typeof agentRunStreamEventSchema>;
type WithoutRun<T> = T extends unknown ? Omit<T, 'runId' | 'conversationId' | 'seq'> : never;
/** 运行时交出来的部分；runId / conversationId / seq 由服务端补上。 */
export type AgentRunStreamPayload = WithoutRun<AgentRunStreamEvent>;

export const events = {
  stream: defineEndpoint({
    method: 'GET',
    path: '/events',
    summary: 'SSE 事件流：hello → changed / heartbeat / agent.run（@Res() 直接写流，契约为 undefined）',
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

/** 小管家确认提案会按提案类型写各个域：助理自己，加上各插件 manifest 的提案声明（actions[].propose / proposals 的 domains）。 */
const PROPOSAL_DOMAINS = ['assistant', ...pluginProposalDomains()] as readonly DomainKey[];

/** 内核条目，不属于任何插件；assistant 工具清单归 J1b（§8.6 第 2 条）。 */
const CORE_EVENT_ROUTES: readonly EventRoute[] = [
  { prefix: '/agent', domains: ['assistant'] },
  { prefix: '/agent/proposals', domains: PROPOSAL_DOMAINS },
  { prefix: '/agent/proposal-groups', domains: PROPOSAL_DOMAINS },
  { prefix: '/internal/agent/channels/:channelId/messages', domains: ['assistant'], emit: 'explicit' },
  { prefix: '/internal/agent/mcp', domains: ['assistant'], emit: 'explicit' },

  { prefix: '/auth/invitations/redeem', domains: ['members'], emit: 'explicit' },
  { prefix: '/household', domains: ['members'] },
  { prefix: '/members/me/preferences', domains: ['members'] },
  { prefix: '/households/me', domains: ['household'] },

  { prefix: '/notifications', domains: ['notifications'] },
  { prefix: '/notification-channels', domains: ['notifications'] },
  { prefix: '/notification-deliveries', domains: ['notifications'] },

  { prefix: '/system/backups', domains: ['backups'] },
  { prefix: '/system/modules', domains: ['modules'] },
];

/** 内核的 + 插件 manifest 生成的。域名是否合法由 scripts/check-plugins.mjs 断言。 */
export const EVENT_ROUTES: readonly EventRoute[] = [
  ...CORE_EVENT_ROUTES,
  ...(pluginEventRoutes() as readonly EventRoute[]),
];

/** 显式豁免：写入不改变任何家庭共享的数据，或事件由别处统一发。每条都要写原因。内核条目，不属于任何插件；assistant 工具清单归 J1b（§8.6 第 2 条）。 */
const CORE_EVENT_ROUTE_EXEMPT: readonly { prefix: string; reason: string }[] = [
  { prefix: '/auth/login', reason: '登录只建本人会话' },
  { prefix: '/auth/refresh', reason: '续期只换令牌' },
  { prefix: '/auth/logout', reason: '退出只吊销本人会话' },
  { prefix: '/auth/invitations/preview', reason: '只读预览' },
  { prefix: '/auth/setup/bootstrap', reason: '首次初始化时还没有任何家里人连着' },
  { prefix: '/accounts/me/password', reason: '只改本人密码' },
  { prefix: '/internal/agent/channels/pair', reason: '渠道配对只影响绑定，管理员设置弹窗打开时重读' },
  { prefix: '/upload', reason: '只存文件，挂到哪条记录由后续写入决定并发事件' },
  { prefix: '/assistant/utterances', reason: '助理原话只是本地日志（J2），不改家庭共享数据；设置页「原话记录」自己重读' },
];

export const EVENT_ROUTE_EXEMPT: readonly { prefix: string; reason: string }[] = [
  ...CORE_EVENT_ROUTE_EXEMPT,
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
