import {
  MediaExternalReference,
  MediaLibraryPoster,
  MediaLibraryProvider,
  MediaProviderHealth,
  MediaServerUser,
} from './providers';
import {
  MediaConnectorConfig,
  MediaConnectorKind,
} from './connectors.config';

export type Fetcher = typeof fetch;

export interface JsonRecord {
  [key: string]: unknown;
}

export class MediaConnectorError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export function asString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

export function buildUrl(baseUrl: string, path: string, params?: URLSearchParams) {
  const url = new URL(path, `${baseUrl}/`);
  if (params) url.search = params.toString();
  return url;
}

export async function fetchJson(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 5000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaConnectorError('连接超时');
    }
    throw new MediaConnectorError('无法连接服务');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MediaConnectorError('凭据无效或权限不足', response.status);
    }
    throw new MediaConnectorError(`服务返回 HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MediaConnectorError('服务返回了无法识别的数据');
  }
}

const ALLOWED_POSTER_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_POSTER_BYTES = 10 * 1024 * 1024;

export async function fetchPoster(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<MediaLibraryPoster> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new MediaConnectorError(
        `海报服务返回 HTTP ${response.status}`,
        response.status,
      );
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_POSTER_TYPES.has(contentType)) {
      throw new MediaConnectorError('海报服务返回了不支持的文件类型');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_POSTER_BYTES) {
      throw new MediaConnectorError('海报文件过大');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > MAX_POSTER_BYTES) {
      throw new MediaConnectorError(body.length ? '海报文件过大' : '海报文件为空');
    }
    return { body, contentType };
  } catch (error) {
    if (error instanceof MediaConnectorError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaConnectorError('海报读取超时');
    }
    throw new MediaConnectorError('无法读取海报');
  } finally {
    clearTimeout(timeout);
  }
}

export function healthFailure(error: unknown): MediaProviderHealth {
  return {
    available: false,
    checkedAt: new Date(),
    message: error instanceof Error ? error.message : '连接失败',
  };
}

export function externalRefKey(reference: MediaExternalReference) {
  return `${reference.provider}:${reference.externalId.toLocaleLowerCase('en-US')}`;
}

export function relevantExternalRefs(references: MediaExternalReference[]) {
  return references.filter(
    (reference) => reference.provider === 'tmdb' || reference.provider === 'imdb',
  );
}

export function integerOrNull(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function requestedSeasons(options: { seasons?: number[] } = {}) {
  return [...new Set(options.seasons ?? [])]
    .filter((season) => Number.isInteger(season) && season >= 1 && season <= 999)
    .sort((left, right) => left - right);
}

export function sortedUniqueUsers(users: MediaServerUser[]) {
  const byId = new Map<string, MediaServerUser>();
  for (const user of users) byId.set(user.externalUserId, user);
  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN'),
  );
}

export interface ConfiguredLibraryProvider {
  config: MediaConnectorConfig;
  provider: MediaLibraryProvider;
}

export function connectorRole(kind: MediaConnectorKind) {
  return kind === 'moviepilot' ? 'automation' as const : 'library' as const;
}
