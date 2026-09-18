import type { QueryClient } from '@tanstack/react-query';
import type {
  AppNotification,
  CalendarEntry,
  Dish,
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
} from '@family/contracts';
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
  '/': (client) => {
    const today = todayISO();
    void client.prefetchQuery({
      queryKey: ['menus-of-date', today],
      queryFn: () => api<Menu[]>(`/menus?date=${today}`),
    });
    void client.prefetchQuery({
      queryKey: ['tasks', today, shiftDays(today, 2)],
      queryFn: () => api<TaskOccurrence[]>(`/tasks?start=${today}&end=${shiftDays(today, 2)}`),
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
  '/eat/shopping': (client) => {
    const today = todayISO();
    void client.prefetchQuery({
      queryKey: ['shopping', today],
      queryFn: () => api<ShoppingItem[]>(`/shopping-list?date=${today}`),
    });
  },
  '/eat/inventory': (client) => {
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

export function prefetchRoute(client: QueryClient, path: string) {
  PREFETCH[path]?.(client);
}

/** 命令面板里搜菜品用得上，顺手让它常驻缓存。 */
export function prefetchSearchSources(client: QueryClient) {
  void client.prefetchQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
    staleTime: 5 * 60_000,
  });
}
