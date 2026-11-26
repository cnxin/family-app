import { createHash } from 'node:crypto';
import type {
  ExternalAccessCredentialKind,
  ExternalAccessPermissionLevel,
} from '@family/contracts';
import type { TailscaleRawDevice } from './tailscale.alerts';
import { tailscaleTimeoutMs } from './tailscale.config';

export interface TailscaleTarget {
  baseUrl: string;
  tailnet: string;
  credentialKind: ExternalAccessCredentialKind;
  oauthClientId: string | null;
  secret: string;
}

export type TailscaleErrorCode =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'http'
  | 'invalid';

export class TailscaleApiError extends Error {
  constructor(
    message: string,
    readonly code: TailscaleErrorCode,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface TailscaleProbeOutcome {
  available: boolean;
  readOnlyVerified: boolean;
  permissionLevel: ExternalAccessPermissionLevel;
  devices: TailscaleRawDevice[];
  message: string;
}

/** 缓存换回来的 OAuth 短期访问令牌（永不落盘、永不打日志），提前 60 秒续换并限制上限避免无限增长。 */
const MAX_OAUTH_TOKEN_CACHE = 64;
const oauthTokenCache = new Map<string, { token: string; expiresAtMs: number }>();

function cacheOAuthToken(key: string, token: string, expiresAtMs: number) {
  const now = Date.now();
  for (const [entryKey, entry] of oauthTokenCache) {
    if (entry.expiresAtMs <= now) oauthTokenCache.delete(entryKey);
  }
  oauthTokenCache.delete(key);
  while (oauthTokenCache.size >= MAX_OAUTH_TOKEN_CACHE) {
    const oldest = oauthTokenCache.keys().next().value;
    if (oldest === undefined) break;
    oauthTokenCache.delete(oldest);
  }
  oauthTokenCache.set(key, { token, expiresAtMs });
}

function drainResponseBody(response: Response) {
  void response.body?.cancel?.().catch(() => {});
}

function oauthCacheKey(target: TailscaleTarget): string {
  return createHash('sha256')
    .update(`${target.baseUrl}\0${target.oauthClientId ?? ''}\0${target.secret}`, 'utf8')
    .digest('hex');
}

export function clearTailscaleTokenCache() {
  oauthTokenCache.clear();
}

function joinApiUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const cleanPath = path.replace(/^\/+/, '');
  return new URL(cleanPath, normalizedBase);
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs = tailscaleTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      // 凭据绝不随 3xx 跳转泄露到其他主机
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TailscaleApiError(
        `连接 Tailscale 控制面超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒未响应）`,
        'timeout',
      );
    }
    throw new TailscaleApiError('连不上 Tailscale 控制面，请检查网络与出口配置', 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeOAuthToken(
  target: TailscaleTarget,
  forceRefresh: boolean,
): Promise<string> {
  if (!target.oauthClientId) {
    throw new TailscaleApiError('OAuth 客户端缺少 Client ID', 'auth');
  }
  const key = oauthCacheKey(target);
  if (!forceRefresh) {
    const cached = oauthTokenCache.get(key);
    if (cached && cached.expiresAtMs - Date.now() > 60_000) {
      return cached.token;
    }
  }
  const body = new URLSearchParams({
    client_id: target.oauthClientId,
    client_secret: target.secret,
    grant_type: 'client_credentials',
  });
  const response = await fetchWithTimeout(joinApiUrl(target.baseUrl, 'api/v2/oauth/token'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    drainResponseBody(response);
    oauthTokenCache.delete(key);
    throw new TailscaleApiError('OAuth 凭据无效或已失效，请检查 Client ID 与 Secret', 'auth', response.status);
  }
  if (!response.ok) {
    drainResponseBody(response);
    throw new TailscaleApiError(`Tailscale OAuth 返回 HTTP ${response.status}`, 'http', response.status);
  }
  let parsed: { access_token?: unknown; expires_in?: unknown };
  try {
    parsed = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  } catch {
    throw new TailscaleApiError('Tailscale OAuth 返回了无法解析的响应', 'invalid');
  }
  if (typeof parsed.access_token !== 'string' || !parsed.access_token.trim()) {
    throw new TailscaleApiError('Tailscale OAuth 未返回有效的访问令牌', 'invalid');
  }
  const expiresInSec =
    typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in) && parsed.expires_in > 0
      ? parsed.expires_in
      : 3600;
  cacheOAuthToken(key, parsed.access_token, Date.now() + expiresInSec * 1000);
  return parsed.access_token;
}

async function resolveBearerToken(
  target: TailscaleTarget,
  forceRefresh = false,
): Promise<string> {
  if (target.credentialKind === 'oauth_client') {
    return exchangeOAuthToken(target, forceRefresh);
  }
  return target.secret;
}

function parseDevice(entry: unknown): TailscaleRawDevice | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null;
  if (!id) return null;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : undefined,
    hostname: typeof record.hostname === 'string' ? record.hostname : undefined,
    user: typeof record.user === 'string' ? record.user : undefined,
    os: typeof record.os === 'string' ? record.os : undefined,
    clientVersion: typeof record.clientVersion === 'string' ? record.clientVersion : undefined,
    updateAvailable: Boolean(record.updateAvailable),
    authorized: record.authorized !== false,
    connectedToControl: Boolean(record.connectedToControl),
    isExternal: Boolean(record.isExternal),
    lastSeen: typeof record.lastSeen === 'string' ? record.lastSeen : undefined,
    expires: typeof record.expires === 'string' ? record.expires : undefined,
    keyExpiryDisabled: Boolean(record.keyExpiryDisabled),
    addresses: record.addresses,
    tags: record.tags,
    blocksIncomingConnections: Boolean(record.blocksIncomingConnections),
    created: typeof record.created === 'string' ? record.created : undefined,
  };
}

async function authorizedJsonGet(
  target: TailscaleTarget,
  path: string,
  forceRefresh = false,
): Promise<{ status: number; body: unknown }> {
  const token = await resolveBearerToken(target, forceRefresh);
  const response = await fetchWithTimeout(joinApiUrl(target.baseUrl, path), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (response.status === 401 && target.credentialKind === 'oauth_client' && !forceRefresh) {
    drainResponseBody(response);
    oauthTokenCache.delete(oauthCacheKey(target));
    return authorizedJsonGet(target, path, true);
  }
  if (response.status === 401) {
    drainResponseBody(response);
    throw new TailscaleApiError('Tailscale 凭据无效或已过期（HTTP 401）', 'auth', 401);
  }
  if (response.status === 403) {
    drainResponseBody(response);
    throw new TailscaleApiError('Tailscale 凭据缺少设备读取权限（devices:core:read）', 'forbidden', 403);
  }
  if (response.status === 404) {
    drainResponseBody(response);
    return { status: 404, body: null };
  }
  if (!response.ok) {
    drainResponseBody(response);
    throw new TailscaleApiError(`Tailscale 控制面返回 HTTP ${response.status}`, 'http', response.status);
  }
  try {
    return { status: response.status, body: (await response.json()) as unknown };
  } catch {
    throw new TailscaleApiError('Tailscale 控制面返回了无法解析的 JSON 数据', 'invalid');
  }
}

export async function fetchTailscaleDevices(
  target: TailscaleTarget,
  forceRefreshToken = false,
): Promise<TailscaleRawDevice[]> {
  const tailnetSegment = encodeURIComponent(target.tailnet);
  const { status, body } = await authorizedJsonGet(
    target,
    `api/v2/tailnet/${tailnetSegment}/devices?fields=all`,
    forceRefreshToken,
  );
  if (status === 404) {
    throw new TailscaleApiError(`找不到 tailnet「${target.tailnet}」（HTTP 404）`, 'not_found', 404);
  }
  const list =
    body && typeof body === 'object' && Array.isArray((body as { devices?: unknown }).devices)
      ? (body as { devices: unknown[] }).devices
      : Array.isArray(body)
        ? body
        : null;
  if (!list) {
    throw new TailscaleApiError('Tailscale 控制面返回了格式异常的设备列表', 'invalid');
  }
  return list.map(parseDevice).filter((device): device is TailscaleRawDevice => device !== null);
}

export async function fetchTailscaleDevice(
  target: TailscaleTarget,
  deviceId: string,
): Promise<TailscaleRawDevice | null> {
  const { status, body } = await authorizedJsonGet(
    target,
    `api/v2/device/${encodeURIComponent(deviceId)}?fields=all`,
  );
  if (status === 404) return null;
  const device = parseDevice(body);
  if (!device) {
    throw new TailscaleApiError('Tailscale 控制面返回了格式异常的设备详情', 'invalid');
  }
  return device;
}

async function postAuthorizedProbe(
  target: TailscaleTarget,
  forceRefresh = false,
): Promise<Response> {
  const token = await resolveBearerToken(target, forceRefresh);
  const response = await fetchWithTimeout(
    joinApiUrl(target.baseUrl, 'api/v2/device/0/authorized'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ authorized: true }),
    },
  );
  if (response.status === 401 && target.credentialKind === 'oauth_client' && !forceRefresh) {
    drainResponseBody(response);
    oauthTokenCache.delete(oauthCacheKey(target));
    return postAuthorizedProbe(target, true);
  }
  return response;
}

/**
 * 阶段 1 只读凭据核验（docs/external-access-plan.md §5.2、§5.6）：
 * 1. 先换令牌（OAuth）并拉一次设备列表，确认具备 devices:core:read；
 * 2. 对不存在的合成设备 ID `0` 发起写探测 POST /api/v2/device/0/authorized（绝不触碰真实设备）：
 *    - 返回 403 → 确认仅具只读权限（read_only）；
 *    - 返回 200 / 204 / 400 / 404 / 409 / 422 → 通过了写权限校验，说明凭据含写权限（read_write），阶段 1 拒绝保存；
 *    - 其余状态 → 无法确认（unknown）。
 */
export async function probeTailscaleReadOnly(
  target: TailscaleTarget,
): Promise<TailscaleProbeOutcome> {
  await resolveBearerToken(target, true);
  const devices = await fetchTailscaleDevices(target, false);
  const probeResponse = await postAuthorizedProbe(target, false);
  const probeStatus = probeResponse.status;
  drainResponseBody(probeResponse);

  if (probeStatus === 403) {
    return {
      available: true,
      readOnlyVerified: true,
      permissionLevel: 'read_only',
      devices,
      message: `已连接控制面（只读权限已核验），共读取到 ${devices.length} 台设备`,
    };
  }
  if (
    probeStatus === 200 ||
    probeStatus === 204 ||
    probeStatus === 400 ||
    probeStatus === 404 ||
    probeStatus === 409 ||
    probeStatus === 422
  ) {
    return {
      available: true,
      readOnlyVerified: false,
      permissionLevel: 'read_write',
      devices,
      message:
        '该凭据具备写权限；阶段 1 仅允许只读凭据（请创建仅含 devices:core:read 的 OAuth 客户端或只读令牌）',
    };
  }
  if (probeStatus === 401) {
    throw new TailscaleApiError('Tailscale 凭据无效或已过期（HTTP 401）', 'auth', 401);
  }
  return {
    available: true,
    readOnlyVerified: false,
    permissionLevel: 'unknown',
    devices,
    message: `已读取设备列表，但只读权限核验返回 HTTP ${probeStatus}`,
  };
}
