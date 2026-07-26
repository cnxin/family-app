import Constants from 'expo-constants';

// Expo Go 开发期：API 跑在起 dev server 的同一台电脑上，从 hostUri 取局域网 IP
function resolveBaseUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3100` : 'http://localhost:3100';
}

export const BASE_URL = resolveBaseUrl();

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.message ?? `请求失败 (${res.status})`,
      res.status,
    );
  }
  return json.data as T;
}

export async function uploadPhoto(uri: string): Promise<string> {
  const form = new FormData();
  form.append('file', {
    uri,
    name: 'photo.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new ApiError('UPLOAD_FAILED', '照片上传失败', res.status);
  const json = await res.json();
  return json.data.url as string;
}

export function photoUri(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BASE_URL}${url}`;
}
