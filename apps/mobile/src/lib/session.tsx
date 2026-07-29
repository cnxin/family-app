import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  ApiError,
  api,
  setAuthRefreshHandler,
  setAuthToken,
  setUnauthorizedHandler,
} from './api';
import type { AccountProfile, Member } from './types';

interface BootstrapInput {
  bootstrapSecret: string;
  householdName: string;
  ownerName: string;
  loginName: string;
  password: string;
}

interface RedeemInvitationInput {
  invitationToken: string;
  loginName: string;
  password: string;
}

interface Session {
  account: AccountProfile | null;
  member: Member | null;
  ready: boolean;
  login: (
    loginName: string,
    password?: string,
    householdSlug?: string,
  ) => Promise<void>;
  bootstrap: (input: BootstrapInput) => Promise<void>;
  redeemInvitation: (input: RedeemInvitationInput) => Promise<void>;
  logout: () => Promise<void>;
  updateAccount: (account: AccountProfile) => Promise<void>;
  updateMember: (member: Member) => Promise<void>;
}

interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  account: AccountProfile;
  member: Member;
}

const SessionContext = createContext<Session>(null as unknown as Session);

const ACCESS_TOKEN_KEY = 'family-app-token';
const REFRESH_TOKEN_KEY = 'family-app-refresh-token';
const ACCOUNT_KEY = 'family-app-account';
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
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshSessionPromiseRef = useRef<Promise<string | null> | null>(null);

  const clearLocalSession = useCallback(async () => {
    refreshTokenRef.current = null;
    setAuthToken(null);
    setAccount(null);
    setMember(null);
    await Promise.all([
      deleteStoredItem(ACCESS_TOKEN_KEY),
      deleteStoredItem(REFRESH_TOKEN_KEY),
      deleteStoredItem(ACCOUNT_KEY),
      deleteStoredItem(MEMBER_KEY),
    ]);
  }, []);

  const applySession = useCallback(async (result: AuthSessionResponse) => {
    refreshTokenRef.current = result.refreshToken;
    setAuthToken(result.accessToken);
    setAccount(result.account);
    setMember(result.member);
    await Promise.all([
      setStoredItem(ACCESS_TOKEN_KEY, result.accessToken),
      setStoredItem(REFRESH_TOKEN_KEY, result.refreshToken),
      setStoredItem(ACCOUNT_KEY, JSON.stringify(result.account)),
      setStoredItem(MEMBER_KEY, JSON.stringify(result.member)),
    ]);
  }, []);

  const refreshSession = useCallback((): Promise<string | null> => {
    if (refreshSessionPromiseRef.current) {
      return refreshSessionPromiseRef.current;
    }

    const attempt = (async () => {
      const refreshToken =
        refreshTokenRef.current ?? (await getStoredItem(REFRESH_TOKEN_KEY));
      if (!refreshToken) return null;

      const result = await api<AuthSessionResponse>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      });
      await applySession(result);
      return result.accessToken;
    })();
    const tracked = attempt.finally(() => {
      if (refreshSessionPromiseRef.current === tracked) {
        refreshSessionPromiseRef.current = null;
      }
    });
    refreshSessionPromiseRef.current = tracked;
    return tracked;
  }, [applySession]);

  useEffect(() => {
    setAuthRefreshHandler(refreshSession);
    setUnauthorizedHandler(() => {
      void clearLocalSession();
    });
    return () => {
      setAuthRefreshHandler(null);
      setUnauthorizedHandler(null);
    };
  }, [clearLocalSession, refreshSession]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [accessToken, refreshToken, accountJson, memberJson] = await Promise.all([
        getStoredItem(ACCESS_TOKEN_KEY),
        getStoredItem(REFRESH_TOKEN_KEY),
        getStoredItem(ACCOUNT_KEY),
        getStoredItem(MEMBER_KEY),
      ]);

      if (!refreshToken || !memberJson) {
        await clearLocalSession();
        if (active) setReady(true);
        return;
      }

      try {
        const cachedMember = JSON.parse(memberJson) as Member;
        const cachedAccount = accountJson
          ? (JSON.parse(accountJson) as AccountProfile)
          : null;
        refreshTokenRef.current = refreshToken;
        setAuthToken(accessToken);
        if (active) setAccount(cachedAccount);
        if (active) setMember(cachedMember);
        await refreshSession();
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof ApiError && error.status === 401)
        ) {
          await clearLocalSession();
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [clearLocalSession, refreshSession]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // 本地退出不能被网络故障阻塞，服务端会话仍会按刷新期限失效。
    } finally {
      await clearLocalSession();
    }
  }, [clearLocalSession]);

  const login = useCallback(
    async (loginName: string, password?: string, householdSlug?: string) => {
      const result = await api<AuthSessionResponse>('/auth/login', {
        method: 'POST',
        body: { loginName, password, householdSlug },
        auth: false,
      });
      await applySession(result);
    },
    [applySession],
  );

  const bootstrap = useCallback(
    async (input: BootstrapInput) => {
      const result = await api<AuthSessionResponse>('/auth/setup/bootstrap', {
        method: 'POST',
        body: input,
        auth: false,
      });
      await applySession(result);
    },
    [applySession],
  );

  const redeemInvitation = useCallback(
    async (input: RedeemInvitationInput) => {
      const result = await api<AuthSessionResponse>('/auth/invitations/redeem', {
        method: 'POST',
        body: input,
        auth: false,
      });
      await applySession(result);
    },
    [applySession],
  );

  const updateAccount = useCallback(async (nextAccount: AccountProfile) => {
    setAccount(nextAccount);
    await setStoredItem(ACCOUNT_KEY, JSON.stringify(nextAccount));
  }, []);

  const updateMember = useCallback(async (nextMember: Member) => {
    setMember(nextMember);
    await setStoredItem(MEMBER_KEY, JSON.stringify(nextMember));
  }, []);

  const value = useMemo(
    () => ({
      account,
      member,
      ready,
      login,
      bootstrap,
      redeemInvitation,
      logout,
      updateAccount,
      updateMember,
    }),
    [
      account,
      member,
      ready,
      login,
      bootstrap,
      redeemInvitation,
      logout,
      updateAccount,
      updateMember,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
