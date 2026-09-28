import { HomeAssistantError, type HomeAssistantTarget } from './home-assistant.client';
import { homeAssistantTimeoutMs } from './home-assistant.config';

/**
 * HA WebSocket API（/api/websocket）的一次性调用：连上 → auth → 依次发命令 → 收齐结果就断开。
 * 设备 / 实体 / 区域这三张注册表 REST 没有，只能走这里。整个过程共用一个超时（默认 3 秒）。
 * E2 的状态订阅（subscribe_events state_changed）另起常驻连接，协议相同。
 */

interface ResultMessage {
  id: number;
  type: 'result';
  success: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

export function homeAssistantWebSocketUrl(baseUrl: string) {
  const url = new URL('api/websocket', `${baseUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function homeAssistantCommands(target: HomeAssistantTarget, types: string[]): Promise<unknown[]> {
  const timeoutMs = homeAssistantTimeoutMs();
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocket;
    const results = new Map<number, unknown>();
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* 已经断了 */
      }
      if (error) reject(error);
      else resolve(types.map((_, index) => results.get(index + 1)));
    };
    const timer = setTimeout(
      () => finish(new HomeAssistantError(`连接超时（${Math.round(timeoutMs / 1000)} 秒没有回应）`)),
      timeoutMs,
    );
    try {
      socket = new WebSocket(homeAssistantWebSocketUrl(target.baseUrl));
    } catch {
      finish(new HomeAssistantError('网络不通，Home Assistant 可能没开'));
      return;
    }
    socket.addEventListener('error', () => finish(new HomeAssistantError('网络不通，Home Assistant 可能没开')));
    socket.addEventListener('close', () => finish(new HomeAssistantError('Home Assistant 断开了连接')));
    socket.addEventListener('message', (event) => {
      let message: Partial<Omit<ResultMessage, 'type'>> & { type?: string };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        finish(new HomeAssistantError('Home Assistant 返回了无法识别的数据'));
        return;
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: target.token }));
      } else if (message.type === 'auth_invalid') {
        finish(new HomeAssistantError('令牌无效或权限不足', 401));
      } else if (message.type === 'auth_ok') {
        types.forEach((type, index) => socket.send(JSON.stringify({ id: index + 1, type })));
      } else if (message.type === 'result' && typeof message.id === 'number') {
        if (!message.success) {
          finish(new HomeAssistantError(`Home Assistant 拒绝了 ${types[message.id - 1] ?? '命令'}：${message.error?.message ?? '未知原因'}`));
          return;
        }
        results.set(message.id, message.result);
        if (results.size === types.length) finish(null);
      }
    });
  });
}

export interface HomeAssistantDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  area_id: string | null;
  manufacturer?: string | null;
  model?: string | null;
  disabled_by?: string | null;
}

export interface HomeAssistantEntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id: string | null;
  entity_category: 'config' | 'diagnostic' | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
}

export interface HomeAssistantArea {
  area_id: string;
  name: string;
}

export interface HomeAssistantRegistries {
  devices: HomeAssistantDevice[];
  entities: HomeAssistantEntityRegistryEntry[];
  areas: HomeAssistantArea[];
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter((entry) => entry && typeof entry === 'object') as T[]) : [];
}

export async function fetchHomeAssistantRegistries(target: HomeAssistantTarget): Promise<HomeAssistantRegistries> {
  const [devices, entities, areas] = await homeAssistantCommands(target, [
    'config/device_registry/list',
    'config/entity_registry/list',
    'config/area_registry/list',
  ]);
  return {
    devices: asList<HomeAssistantDevice>(devices).filter((device) => typeof device.id === 'string'),
    entities: asList<HomeAssistantEntityRegistryEntry>(entities).filter((entry) => typeof entry.entity_id === 'string'),
    areas: asList<HomeAssistantArea>(areas).filter((area) => typeof area.area_id === 'string'),
  };
}

export interface HomeAssistantSubscription {
  close(): void;
}

/**
 * 常驻订阅 state_changed（E2）。连上并订阅成功调 onOpen；每条变化调 onStateChanged(entity_id)；
 * 断了（含鉴权失败、超时、心跳没回）调一次 onClose(原因)，之后这个对象作废，重连由调用方决定。
 * 每 30 秒 ping 一次，70 秒没收到任何消息当作断了。
 */
export function subscribeHomeAssistantStates(
  target: HomeAssistantTarget,
  handlers: { onOpen(): void; onStateChanged(entityId: string): void; onClose(reason: string): void },
): HomeAssistantSubscription {
  let closed = false;
  let socket: WebSocket | null = null;
  let lastMessageAt = Date.now();
  let pingId = 100;
  const openTimer = setTimeout(() => end(`连接超时（${Math.round(homeAssistantTimeoutMs() / 1000)} 秒没有回应）`), homeAssistantTimeoutMs());
  const heartbeat = setInterval(() => {
    if (Date.now() - lastMessageAt > 70_000) return end('心跳没回');
    socket?.send(JSON.stringify({ id: (pingId += 1), type: 'ping' }));
  }, 30_000);

  function end(reason: string, notify = true) {
    if (closed) return;
    closed = true;
    clearTimeout(openTimer);
    clearInterval(heartbeat);
    try {
      socket?.close();
    } catch {
      /* 已经断了 */
    }
    if (notify) handlers.onClose(reason);
  }

  try {
    socket = new WebSocket(homeAssistantWebSocketUrl(target.baseUrl));
  } catch {
    queueMicrotask(() => end('网络不通，Home Assistant 可能没开'));
    return { close: () => end('主动关闭', false) };
  }
  socket.addEventListener('error', () => end('网络不通，Home Assistant 可能没开'));
  socket.addEventListener('close', () => end('Home Assistant 断开了连接'));
  socket.addEventListener('message', (event) => {
    lastMessageAt = Date.now();
    let message: { type?: string; id?: number; success?: boolean; event?: { data?: { entity_id?: unknown } } };
    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'auth_required') {
      socket?.send(JSON.stringify({ type: 'auth', access_token: target.token }));
    } else if (message.type === 'auth_invalid') {
      end('令牌无效或权限不足');
    } else if (message.type === 'auth_ok') {
      socket?.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }));
    } else if (message.type === 'result' && message.id === 1) {
      if (!message.success) return end('Home Assistant 拒绝了订阅');
      clearTimeout(openTimer);
      handlers.onOpen();
    } else if (message.type === 'event' && message.id === 1) {
      const entityId = message.event?.data?.entity_id;
      if (typeof entityId === 'string') handlers.onStateChanged(entityId);
    }
  });
  return { close: () => end('主动关闭', false) };
}
