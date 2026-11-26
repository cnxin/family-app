import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import type { ExternalAccessCredentialKind } from '@family/contracts';
import { isCorsOriginAllowed } from '../common/cors';
import { expandIpv6Hextets } from '../common/tailscale-ingress';

export const DEFAULT_TAILSCALE_API_BASE_URL = 'https://api.tailscale.com';
export const DEFAULT_TAILSCALE_TAILNET = '-';
export const DEFAULT_TAILSCALE_NODE_HOSTNAME = 'xiaoguanjia';

export interface TailscaleServerDefault {
  baseUrl: string;
  tailnet: string;
  publicUrl: string | null;
  nodeHostname: string;
  credentialKind: ExternalAccessCredentialKind | null;
  oauthClientId: string | null;
  secret: string | null;
  allowedHouseholdId: string | null;
}

/** 只有隔离测试库才允许回环 mock 控制面地址（与 common/clock.ts、agent provider-factory 保持一致）。 */
export function isolatedTestMode(): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    /^family_app_(?:web_)?test_[a-f0-9]+$/.test(process.env.DB_NAME ?? '')
  );
}

function readOptionalEnvOrFile(envName: string): string | null {
  const file = process.env[`${envName}_FILE`]?.trim();
  if (file) {
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      // 密钥文件不存在时按「未配置」处理，不阻断 API 启动（同 HA）
    }
  }
  return process.env[envName]?.trim() || null;
}

function isBlockedIpv4Octets(a: number, b: number): boolean {
  return a === 127 || a === 0 || (a === 169 && b === 254);
}

function isBlockedBaseHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    return isBlockedIpv4Octets(parts[0], parts[1]);
  }
  if (isIP(host) === 6) {
    const hextets = expandIpv6Hextets(host);
    if (!hextets) return true;
    const prefixZero = hextets.slice(0, 5).every((value) => value === 0);
    // :: 与 ::1
    if (prefixZero && hextets[5] === 0 && hextets[6] === 0 && (hextets[7] === 0 || hextets[7] === 1)) {
      return true;
    }
    // fe80::/10 链路本地地址
    if ((hextets[0] & 0xffc0) === 0xfe80) return true;
    // ::ffff:0:0/96（IPv4-mapped）、::/96（IPv4-compatible）、::ffff:0:0:0/96（IPv4-translated）与 64:ff9b::/96（NAT64）
    const isMappedOrCompat = prefixZero && (hextets[5] === 0xffff || hextets[5] === 0);
    const isTranslated =
      hextets.slice(0, 4).every((value) => value === 0) && hextets[4] === 0xffff && hextets[5] === 0;
    const isNat64 =
      hextets[0] === 0x0064 && hextets[1] === 0xff9b && hextets.slice(2, 6).every((value) => value === 0);
    if (isMappedOrCompat || isTranslated || isNat64) {
      return isBlockedIpv4Octets(hextets[6] >> 8, hextets[6] & 0xff);
    }
  }
  return false;
}

/**
 * 归一化控制面地址：
 * - 生产/常规模式只允许 HTTPS，且拒绝回环与云元数据网段（169.254.0.0/16）；
 * - 隔离测试库模式下允许 http://127.0.0.1:<port> 连接本地 mock 控制面。
 */
export function normalizeTailscaleBaseUrl(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return DEFAULT_TAILSCALE_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isolatedTestMode() && url.protocol === 'http:' && host === '127.0.0.1') {
    return url.origin;
  }
  if (url.protocol !== 'https:') return undefined;
  if (isBlockedBaseHost(host)) return undefined;
  const cleanPath = url.pathname.replace(/\/+$/, '');
  return cleanPath && cleanPath !== '/' ? `${url.origin}${cleanPath}` : url.origin;
}

/** 归一化管理员填写的私有入口地址（用于展示、二维码和 CORS 自检）。 */
export function normalizeTailscalePublicUrl(
  value: string | null | undefined,
): string | null | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname && url.pathname !== '/') return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol === 'https:') return url.origin;
  if (isolatedTestMode() && url.protocol === 'http:' && host === '127.0.0.1') {
    return url.origin;
  }
  return undefined;
}

export function normalizeTailnet(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return DEFAULT_TAILSCALE_TAILNET;
  return /^(-|[A-Za-z0-9._@+-]{1,200})$/.test(trimmed) ? trimmed : undefined;
}

export function normalizeNodeHostname(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return null;
  let stripped = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) stripped += value[i];
  }
  const cleaned = stripped.trim();
  if (!cleaned) return null;
  if (cleaned.length > 120) return undefined;
  return cleaned;
}

export function maskOauthClientId(clientId: string | null | undefined): string | null {
  const trimmed = clientId?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function isPublicUrlCorsMatched(publicUrl: string | null): boolean | null {
  if (!publicUrl) return null;
  try {
    return isCorsOriginAllowed(new URL(publicUrl).origin);
  } catch {
    return false;
  }
}

export function tailscaleServerDefault(): TailscaleServerDefault {
  const baseUrl =
    normalizeTailscaleBaseUrl(process.env.TAILSCALE_API_BASE_URL) ??
    DEFAULT_TAILSCALE_API_BASE_URL;
  const tailnet =
    normalizeTailnet(process.env.TAILSCALE_TAILNET) ?? DEFAULT_TAILSCALE_TAILNET;
  const publicUrl =
    normalizeTailscalePublicUrl(process.env.TAILSCALE_PUBLIC_URL) ?? null;
  const nodeHostname =
    normalizeNodeHostname(process.env.TAILSCALE_NODE_HOSTNAME) ??
    DEFAULT_TAILSCALE_NODE_HOSTNAME;
  const oauthClientId = readOptionalEnvOrFile('TAILSCALE_OAUTH_CLIENT_ID');
  const oauthClientSecret = readOptionalEnvOrFile('TAILSCALE_OAUTH_CLIENT_SECRET');
  const apiToken = readOptionalEnvOrFile('TAILSCALE_API_TOKEN');
  const allowedHouseholdId = process.env.TAILSCALE_ALLOWED_HOUSEHOLD_ID?.trim() || null;

  if (oauthClientId && oauthClientSecret) {
    return {
      baseUrl,
      tailnet,
      publicUrl,
      nodeHostname,
      credentialKind: 'oauth_client',
      oauthClientId,
      secret: oauthClientSecret,
      allowedHouseholdId,
    };
  }
  if (apiToken) {
    return {
      baseUrl,
      tailnet,
      publicUrl,
      nodeHostname,
      credentialKind: 'api_token',
      oauthClientId: null,
      secret: apiToken,
      allowedHouseholdId,
    };
  }
  return {
    baseUrl,
    tailnet,
    publicUrl,
    nodeHostname,
    credentialKind: null,
    oauthClientId: null,
    secret: null,
    allowedHouseholdId,
  };
}

export function tailscaleServerDefaultConfigured(): boolean {
  const fallback = tailscaleServerDefault();
  return Boolean(fallback.credentialKind && fallback.secret);
}

/** 方案 §5.3：控制面调用默认 3 秒超时，失败只显示「连不上控制面」，其它页面不受影响。 */
export function tailscaleTimeoutMs(): number {
  const configured = Number(process.env.TAILSCALE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100 && configured <= 15_000
    ? configured
    : 3000;
}

export function externalAccessPollIntervalMs(): number {
  const configured = Number(process.env.EXTERNAL_ACCESS_POLL_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 100
    ? Math.min(configured, 86_400_000)
    : 3_600_000;
}

/**
 * 为 Tailscale 设备 ID 派生确定性 RFC 4122 UUID（供 AttentionCandidate.entity.id 与 notifications.sourceId 使用）。
 * Tailscale 设备 ID 本身不是 UUID，而今天页契约与通知表都要求 UUID。
 */
export function deterministicExternalAccessUuid(
  householdId: string,
  deviceId: string,
): string {
  const bytes = createHash('sha256')
    .update(`family-app:external-access:${householdId}:${deviceId}`, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
