import { MediaExternalProvider, MediaType } from '../entities';
import { MediaExternalReference, MediaMetadataSnapshot, MediaProviderHealth } from './providers';

export type Fetcher = typeof fetch;

export type JsonRecord = Record<string, unknown>;

export class MediaMetadataError extends Error {
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
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

export function asNumber(value: unknown) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function yearFrom(value: unknown) {
  const match = asString(value)?.match(/^(\d{4})/);
  const year = match ? Number(match[1]) : null;
  return year && year >= 1878 && year <= 2199 ? year : null;
}

export function absoluteUrl(value: unknown) {
  const candidate = asString(value)?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url;
}

export async function fetchJson(
  fetcher: Fetcher,
  url: URL,
  init: RequestInit,
  timeoutMs = 6000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MediaMetadataError('连接超时');
    }
    throw new MediaMetadataError('无法连接服务');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MediaMetadataError('凭据无效或权限不足', response.status);
    }
    if (response.status === 429) {
      throw new MediaMetadataError('请求过于频繁，请稍后再试', response.status);
    }
    throw new MediaMetadataError(`服务返回 HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MediaMetadataError('服务返回了无法识别的数据');
  }
}

export function failedHealth(error: unknown): MediaProviderHealth {
  return {
    available: false,
    checkedAt: new Date(),
    message: error instanceof Error ? error.message : '连接失败',
  };
}

export function isSnapshot(
  value: MediaMetadataSnapshot | null,
): value is MediaMetadataSnapshot {
  return value !== null;
}

export function allowedBridgeRefs(
  value: unknown,
  type: MediaType,
): MediaExternalReference[] {
  const allowed = new Set<MediaExternalProvider>([
    'tmdb',
    'imdb',
    'bangumi',
  ]);
  return asArray(value).flatMap((candidate) => {
    const record = asRecord(candidate);
    const provider = asString(record.provider) as MediaExternalProvider | null;
    const externalId = asString(record.externalId ?? record.id)?.trim();
    return provider && allowed.has(provider) && externalId
      ? [{ provider, mediaType: type, externalId }]
      : [];
  });
}
