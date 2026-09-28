import type { SmartHomeEntityState } from '@family/contracts';
import { homeAssistantTimeoutMs } from './home-assistant.config';

/** 一次调用要用的地址和长期访问令牌（已解密）。 */
export interface HomeAssistantTarget {
  baseUrl: string;
  token: string;
}

/** HA /api/states 里的一条（只声明用得到的字段）。 */
export interface HomeAssistantRawState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
}

export class HomeAssistantError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

async function request(target: HomeAssistantTarget, path: string) {
  const controller = new AbortController();
  const timeoutMs = homeAssistantTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL(path, `${target.baseUrl}/`), {
      headers: { Authorization: `Bearer ${target.token}`, Accept: 'application/json' },
      // 令牌不跟着跳转走到别的主机
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HomeAssistantError(`连接超时（${Math.round(timeoutMs / 1000)} 秒没有回应）`);
    }
    throw new HomeAssistantError('网络不通，Home Assistant 可能没开');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401 || response.status === 403) {
    throw new HomeAssistantError('令牌无效或权限不足', response.status);
  }
  if (!response.ok) {
    throw new HomeAssistantError(`Home Assistant 返回 HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new HomeAssistantError('Home Assistant 返回了无法识别的数据');
  }
}

/** 连通性：GET /api/ 验令牌，再从 /api/config 取版本号（取不到不算失败）。 */
export async function pingHomeAssistant(target: HomeAssistantTarget) {
  const api = (await request(target, 'api/')) as { message?: unknown } | null;
  if (!api || typeof api.message !== 'string') {
    throw new HomeAssistantError('这个地址不像 Home Assistant');
  }
  const config = (await request(target, 'api/config').catch(() => null)) as { version?: unknown } | null;
  return { version: typeof config?.version === 'string' ? config.version : null };
}

export async function fetchHomeAssistantStates(target: HomeAssistantTarget): Promise<HomeAssistantRawState[]> {
  const body = await request(target, 'api/states');
  if (!Array.isArray(body)) throw new HomeAssistantError('Home Assistant 返回了无法识别的数据');
  return body.filter(
    (entry): entry is HomeAssistantRawState =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as HomeAssistantRawState).entity_id === 'string' &&
      typeof (entry as HomeAssistantRawState).state === 'string',
  );
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

/** 只挑页面用得上的几个属性，不把整份 attributes（可能含位置、账号等）透给客户端。 */
export function presentHomeAssistantState(raw: HomeAssistantRawState): SmartHomeEntityState {
  const attributes = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
  const changed = raw.last_changed ? new Date(raw.last_changed) : null;
  return {
    state: raw.state.slice(0, 255),
    unit: stringOrNull(attributes.unit_of_measurement),
    deviceClass: stringOrNull(attributes.device_class),
    position: numberOrNull(attributes.current_position),
    battery: numberOrNull(attributes.battery_level),
    lastChanged: changed && !Number.isNaN(changed.getTime()) ? changed.toISOString() : null,
  };
}

export function friendlyName(raw: HomeAssistantRawState) {
  const name = raw.attributes?.friendly_name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : raw.entity_id;
}
