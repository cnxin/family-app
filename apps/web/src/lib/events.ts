import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { subscribeEvents } from '@family/api-client';
import type { DomainKey } from '@family/contracts';
import { getAccessToken, refreshAccessToken } from './api';
import { invalidateModules } from './queries/modules';

/**
 * 域 → 这个域的查询 key 前缀（queryKey[0]）。/events 只说「哪个域变了」，收到后让这些查询失效、
 * 自己重取。新加查询时把它的前缀登记到对应的域里，否则别人改了这边不会跟着变。
 */
export const DOMAIN_QUERY_KEYS: Record<DomainKey, readonly string[]> = {
  menus: ['menus-of-date', 'menu', 'menu-dates', 'menu-events', 'menu-inventory-preview'],
  shopping: ['shopping', 'shopping-inventory-preview'],
  calendar: ['calendar'],
  tasks: ['tasks'],
  notifications: ['notifications', 'notification-deliveries', 'notification-channels'],
  recipes: ['recipes', 'recipe', 'dishes'],
  reminders: ['reminders', 'reminder-sources'],
  polls: ['polls'],
  inventory: [
    'inventory', 'inventory-batches', 'inventory-transactions',
    'menu-inventory-preview', 'shopping-inventory-preview', 'maintenance-consumables-preview',
  ],
  assets: ['assets', 'asset', 'maintenance-consumables-preview'],
  finance: ['finance'],
  points: ['rewards', 'reward-redemptions', 'points-accounts', 'points-ledger'],
  guests: [
    'guests', 'visits', 'guest-wifi-profiles', 'guest-meal-requests',
    'guest-invitation', 'guest-meal-options', 'guest-movie-polls',
  ],
  media: [
    'media', 'media-requests', 'media-library', 'media-library-availability', 'media-connectors',
    'media-connector-settings', 'media-metadata-sources', 'media-playback-users', 'viewing-sessions',
  ],
  travel: ['travel-plans', 'travel-plan', 'travel-templates'],
  memories: ['memories'],
  knowledge: ['knowledge', 'knowledge-revisions'],
  activity: ['activities'],
  assistant: [
    'agent-conversation', 'agent-conversations', 'agent-status', 'agent-settings', 'agent-routines',
    'agent-proposal-groups', 'agent-memories', 'agent-channels', 'agent-channel-pairings', 'agent-profile',
  ],
  members: ['members', 'household-members', 'household-invitations'],
  household: ['members'],
  backups: ['backup-dashboard'],
  modules: [],
  'smart-home': [
    'smart-home-states', 'smart-home-devices', 'smart-home-directory', 'smart-home-connector-settings',
    'smart-home-commands',
  ],
};

/**
 * 几乎任何写入都可能改变的：家庭动态、站内通知（划掉别人点的菜、访客回复等都会顺带给人发通知，
 * 路由映射里不逐条标 notifications）。留意与家里页状态由 invalidateModules 一起刷新。
 */
const ALWAYS = ['activities', 'notifications'];

export function invalidateDomains(client: QueryClient, domains: readonly DomainKey[]) {
  const prefixes = new Set(ALWAYS);
  for (const domain of domains) for (const prefix of DOMAIN_QUERY_KEYS[domain] ?? []) prefixes.add(prefix);
  for (const prefix of prefixes) void client.invalidateQueries({ queryKey: [prefix] });
  void invalidateModules(client);
}

/** 连不上超过这么久才提示；短暂抖一下不打扰。 */
export const PAUSED_NOTICE_MS = 30_000;

/**
 * 外壳级订阅：登录后建立，登出（组件卸载）断开。
 * 连不上的时段里变化收不到：重新连上时做一次全量失效补齐（第一次顺利连上不做）；
 * 页面回到前台时若没连着立刻重连。
 */
export function useLiveEvents() {
  const client = useQueryClient();
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let pausedTimer: ReturnType<typeof setTimeout> | null = null;
    // 有过连不上的时段（断线或一开始就没连上）：这段时间的变化没收到，连上时全量补齐
    let hadGap = false;
    // 卸载时主动关闭也会报一次 closed，不能因此起「已暂停」计时器（开发模式 effect 会挂两次）
    let disposed = false;
    const clearPaused = () => {
      if (pausedTimer) clearTimeout(pausedTimer);
      pausedTimer = null;
    };
    const sub = subscribeEvents({
      url: '/api/events',
      credentials: { getAccessToken, refreshAccessToken },
      handlers: {
        onHello() {
          clearPaused();
          setPaused(false);
          setDismissed(false);
          if (hadGap) void client.invalidateQueries();
          hadGap = false;
        },
        onChanged(change) {
          invalidateDomains(client, change.domains);
        },
        onStatus(status) {
          if (disposed || status === 'open') return;
          hadGap = true;
          if (!pausedTimer) pausedTimer = setTimeout(() => setPaused(true), PAUSED_NOTICE_MS);
        },
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') sub.reconnectNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      clearPaused();
      document.removeEventListener('visibilitychange', onVisible);
      sub.close();
    };
  }, [client]);

  return { paused: paused && !dismissed, dismiss: () => setDismissed(true) };
}
