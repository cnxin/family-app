import { readFileSync } from 'fs';

export interface TmdbMetadataConfig {
  baseUrl: string;
  imageBaseUrl: string;
  token: string | null;
  apiKey: string | null;
}

export interface DoubanMetadataConfig {
  baseUrl: string | null;
  token: string | null;
}

export interface BangumiMetadataConfig {
  baseUrl: string;
  token: string | null;
  userAgent: string;
}

export interface MediaMetadataConfig {
  tmdb: TmdbMetadataConfig;
  douban: DoubanMetadataConfig;
  bangumi: BangumiMetadataConfig;
}

function optionalSecret(name: string) {
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) {
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (!value) throw new Error('密钥文件为空');
      return value;
    } catch {
      throw new Error(`无法读取 ${name}_FILE 指定的元数据密钥文件`);
    }
  }
  return process.env[name]?.trim() || null;
}

function configuredBaseUrl(name: string, fallback: string | null) {
  const value = process.env[name]?.trim() || fallback;
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
  if (url.username || url.password) {
    throw new Error(`${name} 不能在地址中包含用户名或密码`);
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function mediaMetadataConfig(): MediaMetadataConfig {
  return {
    tmdb: {
      baseUrl: configuredBaseUrl(
        'TMDB_API_BASE_URL',
        'https://api.themoviedb.org/3',
      )!,
      imageBaseUrl: configuredBaseUrl(
        'TMDB_IMAGE_BASE_URL',
        'https://image.tmdb.org/t/p/w500',
      )!,
      token: optionalSecret('TMDB_API_TOKEN'),
      apiKey: optionalSecret('TMDB_API_KEY'),
    },
    douban: {
      baseUrl: configuredBaseUrl('DOUBAN_API_BASE_URL', null),
      token: optionalSecret('DOUBAN_API_TOKEN'),
    },
    bangumi: {
      baseUrl: configuredBaseUrl(
        'BANGUMI_API_BASE_URL',
        'https://api.bgm.tv',
      )!,
      token: optionalSecret('BANGUMI_ACCESS_TOKEN'),
      userAgent:
        process.env.BANGUMI_USER_AGENT?.trim() ||
        'family-app/0.1 (self-hosted household media search)',
    },
  };
}
