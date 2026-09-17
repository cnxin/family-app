import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthSession, LoginBody } from '@family/contracts';
import { api, setAccessToken, setAuthHandlers } from './api';

const STORAGE_KEY = 'family-app.session';

interface AuthValue {
  session: AuthSession | null;
  ready: boolean;
  signIn: (body: LoginBody) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function read(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}
function write(session: AuthSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 隐私模式下写不进去，不影响本次会话 */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => {
    const stored = read();
    setAccessToken(stored?.accessToken ?? null);
    return stored;
  });

  const signOut = useCallback(() => {
    setSession(null);
    write(null);
    setAccessToken(null);
  }, []);

  const apply = useCallback((next: AuthSession) => {
    setSession(next);
    write(next);
    setAccessToken(next.accessToken);
  }, []);

  useEffect(() => {
    setAuthHandlers({
      unauthorized: signOut,
      refresh: async () => {
        const current = read();
        if (!current?.refreshToken) return null;
        try {
          const next = await api<AuthSession>('/auth/refresh', {
            method: 'POST',
            auth: false,
            body: { refreshToken: current.refreshToken },
          });
          apply(next);
          return next.accessToken;
        } catch {
          signOut();
          return null;
        }
      },
    });
    return () => setAuthHandlers({ refresh: null, unauthorized: null });
  }, [apply, signOut]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      // 会话是同步从 localStorage 读出来的，首帧就是最终状态；ready 留着只为了接口不变
      ready: true,
      signOut,
      signIn: async (body) => {
        const next = await api<AuthSession>('/auth/login', { method: 'POST', auth: false, body });
        apply(next);
      },
    }),
    [session, signOut, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 里用');
  return value;
}
