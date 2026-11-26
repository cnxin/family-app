import { isIP } from 'node:net';

/**
 * Tailscale Serve 入口与身份头识别（docs/external-access-plan.md §5.4，纯函数放在 common/ 供 auth 与 external-access 共用）。
 *
 * 只有同时满足以下三条才认定经由 Tailscale Serve 外部通道接入：
 * 1. 请求头 `X-Family-Ingress: tailscale`（仅 Caddy :8080 回环专用入口注入，:80 入口剥离）；
 * 2. 客户端 IP（经 TRUST_PROXY_HOPS=2 解析的 req.ip）落入 Tailscale 双栈地址段：
 *    - IPv4 CGNAT `100.64.0.0/10`（含 IPv4-mapped IPv6 `::ffff:100.x.y.z`）
 *    - IPv6 ULA `fd7a:115c:a1e0::/48`
 * 3. 请求头 `Tailscale-User-Login` 非空（Tailscale Serve 转发前会先删掉外来同名头）。
 */
export interface TailscaleIngressContext {
  viaTailscale: boolean;
  login: string | null;
  name: string | null;
}

export interface TailscaleIngressRequestLike {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

const INACTIVE: TailscaleIngressContext = {
  viaTailscale: false,
  login: null,
  name: null,
};

function firstHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === 'string' ? raw : null;
}

function stripControlChars(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) result += value[i];
  }
  return result;
}

function sanitizeHeaderText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = stripControlChars(value).trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

/** 归一化客户端 IP：去空白、括号、::ffff: 前缀与 IPv6 zone 后缀，不合法返回 null。 */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  let value = raw?.trim() ?? '';
  if (!value) return null;
  if (value.startsWith('[')) {
    const closeBracket = value.indexOf(']');
    if (closeBracket <= 1) return null;
    const trailing = value.slice(closeBracket + 1);
    if (trailing && !trailing.startsWith('%')) return null;
    value = value.slice(1, closeBracket);
  }
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) value = value.slice(0, zoneIndex);
  if (value.toLowerCase().startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) value = mapped;
  }
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) {
    const lower = value.toLowerCase();
    const hextets = expandIpv6Hextets(lower);
    if (hextets && hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff) {
      return `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
    }
    return lower;
  }
  return null;
}

export function expandIpv6Hextets(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const tokens = part.split(':');
    const result: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.includes('.')) {
        if (i !== tokens.length - 1 || isIP(token) !== 4) return null;
        const octets = token.split('.').map(Number);
        result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        result.push(parseInt(token, 16));
      }
    }
    return result;
  };
  const left = parsePart(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parsePart(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/** 判断客户端 IP 是否属于 Tailscale 双栈地址段（100.64.0.0/10 或 fd7a:115c:a1e0::/48）。 */
export function isTailscaleIp(raw: string | null | undefined): boolean {
  const normalized = normalizeClientIp(raw);
  if (!normalized) return false;
  const family = isIP(normalized);
  if (family === 4) {
    const parts = normalized.split('.').map(Number);
    return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }
  if (family === 6) {
    const hextets = expandIpv6Hextets(normalized);
    return Boolean(
      hextets &&
        hextets[0] === 0xfd7a &&
        hextets[1] === 0x115c &&
        hextets[2] === 0xa1e0,
    );
  }
  return false;
}

export function extractTailscaleIngress(
  request: TailscaleIngressRequestLike | undefined,
): TailscaleIngressContext {
  if (!request) return INACTIVE;
  const ingress = sanitizeHeaderText(firstHeader(request.headers, 'x-family-ingress'), 32);
  if (ingress?.toLowerCase() !== 'tailscale') return INACTIVE;
  if (!isTailscaleIp(request.ip)) return INACTIVE;
  const login = sanitizeHeaderText(firstHeader(request.headers, 'tailscale-user-login'), 320);
  if (!login) return INACTIVE;
  const name = sanitizeHeaderText(firstHeader(request.headers, 'tailscale-user-name'), 200);
  return { viaTailscale: true, login, name };
}
