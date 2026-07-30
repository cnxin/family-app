import { readFileSync } from 'fs';

export type MediaConnectorKind = 'plex' | 'emby' | 'moviepilot';

export interface MediaConnectorConfig {
  key: MediaConnectorKind;
  kind: MediaConnectorKind;
  name: string;
  baseUrl: string | null;
  credential: string | null;
  primary: boolean;
  enabled?: boolean;
}

function optionalSecret(name: string) {
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) {
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (!value) throw new Error('密钥文件为空');
      return value;
    } catch {
      throw new Error(`无法读取 ${name}_FILE 指定的连接器密钥文件`);
    }
  }
  return process.env[name]?.trim() || null;
}

function optionalBaseUrl(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} 必须是完整的 HTTP 或 HTTPS 地址`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} 只支持 HTTP 或 HTTPS 地址`);
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function mediaConnectorConfigs(): MediaConnectorConfig[] {
  const primaryValue = process.env.MEDIA_PRIMARY_LIBRARY?.trim().toLowerCase();
  if (primaryValue && !['plex', 'emby'].includes(primaryValue)) {
    throw new Error('MEDIA_PRIMARY_LIBRARY 只能是 plex 或 emby');
  }
  const primary = primaryValue as 'plex' | 'emby' | undefined;
  return [
    {
      key: 'plex',
      kind: 'plex',
      name: process.env.PLEX_NAME?.trim() || 'Plex',
      baseUrl: optionalBaseUrl('PLEX_BASE_URL'),
      credential: optionalSecret('PLEX_TOKEN'),
      primary: primary ? primary === 'plex' : true,
    },
    {
      key: 'emby',
      kind: 'emby',
      name: process.env.EMBY_NAME?.trim() || 'Emby',
      baseUrl: optionalBaseUrl('EMBY_BASE_URL'),
      credential: optionalSecret('EMBY_API_KEY'),
      primary: primary === 'emby',
    },
    {
      key: 'moviepilot',
      kind: 'moviepilot',
      name: process.env.MOVIEPILOT_NAME?.trim() || 'MoviePilot',
      baseUrl: optionalBaseUrl('MOVIEPILOT_BASE_URL'),
      credential: optionalSecret('MOVIEPILOT_API_KEY'),
      primary: false,
    },
  ];
}
