import type { QueryClient } from '@tanstack/react-query';
import type {
  AppNotification,
  AuthSession,
  CalendarEntry,
  Dish,
  FinanceAccount,
  FinanceSummary,
  HouseholdPoll,
  HomeAsset,
  HouseholdReminder,
  ManagedMember,
  PointsAccount,
  Reward,
  InventoryItem,
  Menu,
  RecipeDish,
  ShoppingItem,
  TaskOccurrence,
  TodayAttention,
} from '@family/contracts';
import { pluginCapabilities } from '@family/contracts';
import { householdToday } from '@family/shared';
import { prefetchAttention } from './attention-prefetch';
import { api } from './api';
import { shiftDays, todayISO } from './queries';
import { calendarRange, startOfMonth } from '../components/calendar-month';

/**
 * 预取：鼠标悬停或手指按下标签的那一刻就开始拉数据，
 * 等手指抬起来路由切过去时，缓存里通常已经有了，页面直接就是有内容的。
 * 键和各自的 hook 必须完全一致，否则预取白做——所以这里只写「整页第一屏要的那一个」，
 * 剩下的交给页面自己。
 */
const PREFETCH: Record<string, (client: QueryClient) => void> = {
  '/house/members': (client) => {
    void client.prefetchQuery({
      queryKey: ['household-members'],
      queryFn: () => api<ManagedMember[]>('/household/members'),
    });
  },
  '/house/assets': (client) => {
    void client.prefetchQuery({
      queryKey: ['assets', 'all'],
      queryFn: () => api<HomeAsset[]>('/assets?status=all'),
    });
  },
  '/house/points': (client) => {
    void client.prefetchQuery({
      queryKey: ['points-accounts'],
      queryFn: () => api<PointsAccount[]>('/points/accounts'),
    });
    void client.prefetchQuery({
      queryKey: ['rewards', true],
      queryFn: () => api<Reward[]>('/rewards?includeInactive=true'),
    });
  },
  '/schedule/polls': (client) => {
    void client.prefetchQuery({
      queryKey: ['polls'],
      queryFn: () => api<HouseholdPoll[]>('/polls?status=all'),
    });
  },
  '/home': (client) => {
    void client.prefetchQuery({ queryKey: ['today', 'attention'], queryFn: () => api<TodayAttention>('/today/attention') });
  },
  '/': (client) => {
    void client.prefetchQuery({ queryKey: ['today', 'attention'], queryFn: () => api<TodayAttention>('/today/attention') });
    const today = todayISO();
    void client.prefetchQuery({
      queryKey: ['menus-of-date', today],
      queryFn: () => api<Menu[]>(`/menus?date=${today}`),
    });
    void client.prefetchQuery({
      queryKey: ['tasks', today, shiftDays(today, 2)],
      queryFn: () => api<TaskOccurrence[]>(`/tasks?start=${today}&end=${shiftDays(today, 2)}`),
    });
    void client.prefetchQuery({
      queryKey: ['calendar', today, today],
      queryFn: () => api<CalendarEntry[]>(`/calendar?start=${today}&end=${today}`),
    });
  },
  '/eat/order': (client) => {
    void client.prefetchQuery({
      queryKey: ['dishes'],
      queryFn: () => api<Dish[]>('/dishes'),
      staleTime: 5 * 60_000,
    });
  },
  '/eat/kitchen': (client) => {
    const today = todayISO();
    void client.prefetchQuery({
      queryKey: ['menus-of-date', today],
      queryFn: () => api<Menu[]>(`/menus?date=${today}`),
    });
  },
  '/eat/recipes': (client) => {
    void client.prefetchQuery({
      queryKey: ['recipes'],
      queryFn: () => api<RecipeDish[]>('/recipes'),
      staleTime: 5 * 60_000,
    });
  },
  '/house/shopping': (client) => {
    const today = todayISO();
    void client.prefetchQuery({
      queryKey: ['shopping', today],
      queryFn: () => api<ShoppingItem[]>(`/shopping-list?date=${today}`),
    });
  },
  '/house/inventory': (client) => {
    void client.prefetchQuery({
      queryKey: ['inventory'],
      queryFn: () => api<InventoryItem[]>('/inventory'),
    });
  },
  '/schedule/calendar': (client) => {
    const { start, end } = calendarRange(startOfMonth(new Date()));
    void client.prefetchQuery({
      queryKey: ['calendar', start, end],
      queryFn: () => api<CalendarEntry[]>(`/calendar?start=${start}&end=${end}`),
    });
  },
  '/schedule/notifications': (client) => {
    void client.prefetchQuery({
      queryKey: ['notifications', false],
      queryFn: () => api<AppNotification[]>('/notifications'),
    });
  },
  '/schedule/reminders': (client) => {
    void client.prefetchQuery({
      queryKey: ['reminders', 'all'],
      queryFn: () => api<HouseholdReminder[]>('/reminders?status=all'),
    });
  },
  '/schedule/tasks': (client) => {
    const start = todayISO();
    const end = shiftDays(start, 6);
    void client.prefetchQuery({
      queryKey: ['tasks', start, end],
      queryFn: () => api<TaskOccurrence[]>(`/tasks?start=${start}&end=${end}`),
    });
  },
};

/** 这个角色有没有某项能力：按各插件 manifest 声明的能力表判（和 API 的 ROLE_CAPABILITIES 同一份来源）。 */
export function roleCan(session: AuthSession | null | undefined, capability: string) {
  if (!session) return false;
  return pluginCapabilities().some((one) => one.key === capability && one.roles.includes(session.member.role));
}

/**
 * 要看权限的预取：按能力判，不按角色。财务概览（当月汇总 + 账户）对成员也预取——成员本来就有 view_finance（J1.3）。
 * 键和财务页的 hook 一致：月份按家庭时区的今天。
 */
const PREFETCH_WITH_CAPABILITY: Record<string, { capability: string; run: (client: QueryClient, session: AuthSession) => void }> = {
  '/house/finance': {
    capability: 'view_finance',
    run: (client, session) => {
      const month = householdToday(session.householdTimezone ?? 'Asia/Shanghai').slice(0, 7);
      void client.prefetchQuery({
        queryKey: ['finance', 'summary', month],
        queryFn: () => api<FinanceSummary>(`/finance/summary?month=${month}`),
      });
      void client.prefetchQuery({
        queryKey: ['finance', 'accounts'],
        queryFn: () => api<FinanceAccount[]>('/finance/accounts?includeInactive=true'),
      });
    },
  },
};

export function prefetchRoute(client: QueryClient, path: string, session?: AuthSession | null) {
  if ((path === '/' || path === '/home') && session) prefetchAttention(client, session);
  PREFETCH[path]?.(client);
  const gated = PREFETCH_WITH_CAPABILITY[path];
  if (gated && session && roleCan(session, gated.capability)) gated.run(client, session);
}

/** 命令面板里搜菜品用得上，顺手让它常驻缓存。 */
export function prefetchSearchSources(client: QueryClient) {
  void client.prefetchQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
    staleTime: 5 * 60_000,
  });
}
