import type { EventsChanged, EventsHello } from '@family/contracts';

/**
 * /events 订阅（H2b）。服务端只推「哪个域变了」，调用方收到后让对应查询失效、自己重取。
 *
 * - 凭据由调用方注入（Web 用内存里的访问令牌 + 现有续期；将来的壳 / 小程序各自实现），
 *   令牌走 Authorization 请求头，不进 URL；
 * - 传输层可替换：默认 SSE over fetch + ReadableStream；小程序没有 ReadableStream，
 *   将来换成 WebSocket 传同样的帧即可；
 * - 断了就指数退避重连（1s → 30s 封顶），收到 hello 算连上并清零退避；
 *   45 秒收不到任何帧（服务端每 20 秒一条心跳）当作断线；
 * - 401 先续期一次再连，续期失败就停下（交给调用方登出）。
 */

export type EventsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventsCredentials {
  getAccessToken(): string | null;
  /** 访问令牌过期时换一个；返回 null 表示续期失败。 */
  refreshAccessToken(): Promise<string | null>;
}

export interface EventsHandlers {
  onHello?(hello: EventsHello): void;
  onChanged(change: EventsChanged): void;
  onStatus?(status: EventsStatus): void;
}

export interface EventsTransportOptions {
  url: string;
  token: string;
  signal: AbortSignal;
  onFrame(event: string, data: string): void;
}

/** 一次连接：按帧回调；正常结束（服务端关流）resolve，出错 reject。 */
export type EventsTransport = (options: EventsTransportOptions) => Promise<void>;

export class EventsUnauthorizedError extends Error {
  constructor() {
    super('events unauthorized');
  }
}

/** 默认传输：fetch 读 SSE。帧以空行分隔，只认 `event:` 和 `data:` 两种行。 */
export const sseOverFetch: EventsTransport = async ({ url, token, signal, onFrame }) => {
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (response.status === 401) throw new EventsUnauthorizedError();
  if (!response.ok || !response.body) throw new Error(`events 连接失败：${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
      }
      onFrame(event, data);
      boundary = buffer.indexOf('\n\n');
    }
  }
};

export interface EventsSubscription {
  readonly status: EventsStatus;
  /** 没连着时立刻重连（比如页面从后台回到前台），不等退避。 */
  reconnectNow(): void;
  close(): void;
}

export interface SubscribeEventsOptions {
  url: string;
  credentials: EventsCredentials;
  handlers: EventsHandlers;
  transport?: EventsTransport;
  idleTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export function subscribeEvents(options: SubscribeEventsOptions): EventsSubscription {
  const transport = options.transport ?? sseOverFetch;
  const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  const minBackoffMs = options.minBackoffMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  let status: EventsStatus = 'connecting';
  let closed = false;
  let attempt = 0;
  let controller: AbortController | null = null;
  let wake: (() => void) | null = null;

  const setStatus = (next: EventsStatus) => {
    if (status === next) return;
    status = next;
    options.handlers.onStatus?.(next);
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = done;
    });

  async function connectOnce(token: string) {
    controller = new AbortController();
    const current = controller;
    let idle = setTimeout(() => current.abort(), idleTimeoutMs);
    try {
      await transport({
        url: options.url,
        token,
        signal: current.signal,
        onFrame(event, data) {
          clearTimeout(idle);
          idle = setTimeout(() => current.abort(), idleTimeoutMs);
          if (event === 'hello') {
            attempt = 0;
            setStatus('open');
            options.handlers.onHello?.(JSON.parse(data) as EventsHello);
          } else if (event === 'changed') {
            options.handlers.onChanged(JSON.parse(data) as EventsChanged);
          }
        },
      });
    } finally {
      clearTimeout(idle);
      controller = null;
    }
  }

  void (async () => {
    while (!closed) {
      let token = options.credentials.getAccessToken();
      try {
        if (!token) throw new EventsUnauthorizedError();
        await connectOnce(token);
      } catch (error) {
        if (closed) break;
        if (error instanceof EventsUnauthorizedError) {
          token = await options.credentials.refreshAccessToken();
          if (!token) {
            setStatus('closed');
            return;
          }
          continue;
        }
      }
      if (closed) break;
      setStatus('reconnecting');
      await sleep(Math.min(maxBackoffMs, minBackoffMs * 2 ** attempt));
      attempt += 1;
    }
    setStatus('closed');
  })();

  return {
    get status() {
      return status;
    },
    reconnectNow() {
      if (status !== 'open') wake?.();
    },
    close() {
      closed = true;
      controller?.abort();
      wake?.();
    },
  };
}
