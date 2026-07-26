import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from './api';
import type { Member } from './types';

interface Session {
  member: Member | null;
  ready: boolean;
  login: (memberId: string, pin?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session>(null as unknown as Session);

const TOKEN_KEY = 'family-app-token';
const MEMBER_KEY = 'family-app-member';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [token, memberJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(MEMBER_KEY),
        ]);
        if (token && memberJson) {
          setAuthToken(token);
          setMember(JSON.parse(memberJson));
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    setMember(null);
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(MEMBER_KEY),
    ]);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
  }, [logout]);

  const login = useCallback(async (memberId: string, pin?: string) => {
    const result = await api<{ token: string; member: Member }>('/auth/login', {
      method: 'POST',
      body: { memberId, pin },
    });
    setAuthToken(result.token);
    setMember(result.member);
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, result.token),
      SecureStore.setItemAsync(MEMBER_KEY, JSON.stringify(result.member)),
    ]);
  }, []);

  const value = useMemo(
    () => ({ member, ready, login, logout }),
    [member, ready, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
