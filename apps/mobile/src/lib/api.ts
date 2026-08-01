import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AssetDocument, AssetDocumentType } from './types';

// Expo Go 开发期：API 跑在起 dev server 的同一台电脑上，从 hostUri 取局域网 IP
function resolveBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3100`;
  }

  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3100` : 'http://localhost:3100';
}

export const BASE_URL = resolveBaseUrl();

type AuthRefreshHandler = () => Promise<string | null>;

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onAuthRefresh: AuthRefreshHandler | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function setAuthRefreshHandler(fn: AuthRefreshHandler | null) {
  onAuthRefresh = fn;
  refreshPromise = null;
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

interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!onAuthRefresh) return null;
  if (!refreshPromise) {
    const currentRefresh = onAuthRefresh;
    const attempt = currentRefresh();
    const tracked = attempt.finally(() => {
      if (refreshPromise === tracked) refreshPromise = null;
    });
    refreshPromise = tracked;
  }
  return refreshPromise;
}

async function fetchWithSession(
  url: string,
  init: RequestInit,
  useAuth: boolean,
): Promise<Response> {
  const execute = async () => {
    const requestToken = useAuth ? authToken : null;
    const headers = new Headers(init.headers);
    if (requestToken) {
      headers.set('Authorization', `Bearer ${requestToken}`);
    }
    return {
      requestToken,
      response: await fetch(url, { ...init, headers }),
    };
  };

  let attempt = await execute();
  if (!useAuth || attempt.response.status !== 401) return attempt.response;

  if (attempt.requestToken !== authToken) {
    if (!authToken) {
      onUnauthorized?.();
      return attempt.response;
    }
    attempt = await execute();
    if (attempt.response.status !== 401) return attempt.response;
  }

  let refreshedToken: string | null;
  try {
    refreshedToken = await refreshAccessToken();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) onUnauthorized?.();
    throw error;
  }

  if (refreshedToken) attempt = await execute();
  if (attempt.response.status === 401) onUnauthorized?.();
  return attempt.response;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const response = await fetchWithSession(
    `${BASE_URL}${path}`,
    {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body != null ? JSON.stringify(options.body) : undefined,
    },
    options.auth !== false,
  );
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.message ?? `请求失败 (${response.status})`,
      response.status,
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
  const response = await fetchWithSession(
    `${BASE_URL}/upload`,
    { method: 'POST', body: form },
    true,
  );
  if (!response.ok) {
    throw new ApiError('UPLOAD_FAILED', '照片上传失败', response.status);
  }
  const json = await response.json();
  return json.data.url as string;
}

export async function uploadAssetDocument(
  assetId: string,
  type: AssetDocumentType,
  title: string,
  uri: string,
): Promise<AssetDocument> {
  const form = new FormData();
  form.append('type', type);
  form.append('title', title);
  form.append('file', {
    uri,
    name: 'asset-document.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  const response = await fetchWithSession(
    `${BASE_URL}/assets/${encodeURIComponent(assetId)}/documents/upload`,
    { method: 'POST', body: form },
    true,
  );
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      json?.error?.code ?? 'UPLOAD_FAILED',
      json?.error?.message ?? '资产资料上传失败',
      response.status,
    );
  }
  return json.data as AssetDocument;
}

export function photoUri(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BASE_URL}${url}`;
}
