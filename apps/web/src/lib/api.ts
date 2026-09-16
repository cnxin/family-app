// 和 apps/mobile/src/lib/api.ts 同样的语义：{data} / {error:{code,message}} 信封、
// 401 自动续期一次、续期失败就登出。区别只是这里没有 Expo 那套主机名推断。

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onRefresh: (() => Promise<string | null>) | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setAuthHandlers(handlers: {
  refresh: (() => Promise<string | null>) | null;
  unauthorized: (() => void) | null;
}) {
  onRefresh = handlers.refresh;
  onUnauthorized = handlers.unauthorized;
  refreshing = null;
}

function refreshOnce() {
  if (!onRefresh) return Promise.resolve(null);
  if (!refreshing) {
    const attempt = onRefresh();
    const tracked = attempt.finally(() => {
      if (refreshing === tracked) refreshing = null;
    });
    refreshing = tracked;
  }
  return refreshing;
}

interface Options {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function once<T>(path: string, options: Options, token: string | null): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? '请求失败',
      response.status,
      payload?.requestId,
    );
  }
  return payload?.data as T;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const needsAuth = options.auth !== false;
  try {
    return await once<T>(path, options, needsAuth ? accessToken : null);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !needsAuth) throw error;
    const renewed = await refreshOnce();
    if (!renewed) {
      onUnauthorized?.();
      throw error;
    }
    return once<T>(path, options, renewed);
  }
}
