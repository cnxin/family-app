import { readFileSync } from 'fs';

/**
 * 服务器默认的 Home Assistant 连接：HOME_ASSISTANT_BASE_URL + HOME_ASSISTANT_TOKEN（或 _TOKEN_FILE）。
 * 家庭在设置页填了自己的就以家庭为准（同媒体连接器）。
 *
 * 和媒体连接器不同：令牌文件不存在不算错，只是「还没配」——部署时先预留变量、HA 装好后才生成令牌。
 * 每次都重新读文件，写进令牌后不用重启 API。
 */
export interface HomeAssistantServerDefault {
  baseUrl: string | null;
  credential: string | null;
}

export function normalizeHomeAssistantBaseUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return undefined;
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function serverToken() {
  const file = process.env.HOME_ASSISTANT_TOKEN_FILE?.trim();
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
  return process.env.HOME_ASSISTANT_TOKEN?.trim() || null;
}

export function homeAssistantServerDefault(): HomeAssistantServerDefault {
  return {
    baseUrl: normalizeHomeAssistantBaseUrl(process.env.HOME_ASSISTANT_BASE_URL) ?? null,
    credential: serverToken(),
  };
}

export function homeAssistantServerDefaultConfigured() {
  const fallback = homeAssistantServerDefault();
  return Boolean(fallback.baseUrl && fallback.credential);
}

/** 每次调用 HA 的超时。方案 §6.5：3 秒，失败就显示「连不上」，别的页面不受影响。 */
export function homeAssistantTimeoutMs() {
  const configured = Number(process.env.HOME_ASSISTANT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 3000;
}
