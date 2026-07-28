import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
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

function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window === 'undefined' ? null : window.localStorage.getItem(key),
    );
  }
  return SecureStore.getItemAsync(key);
}

function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, value);
}

function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [token, memberJson] = await Promise.all([
          getStoredItem(TOKEN_KEY),
          getStoredItem(MEMBER_KEY),
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
      deleteStoredItem(TOKEN_KEY),
      deleteStoredItem(MEMBER_KEY),
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
      setStoredItem(TOKEN_KEY, result.token),
      setStoredItem(MEMBER_KEY, JSON.stringify(result.member)),
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
