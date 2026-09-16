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
  const [session, setSession] = useState<AuthSession | null>(() => read());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAccessToken(session?.accessToken ?? null);
    setReady(true);
  }, [session]);

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
      ready,
      signOut,
      signIn: async (body) => {
        const next = await api<AuthSession>('/auth/login', { method: 'POST', auth: false, body });
        apply(next);
      },
    }),
    [session, ready, signOut, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 里用');
  return value;
}
