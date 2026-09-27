import { useQuery } from '@tanstack/react-query';
import type { ActivityModule, HouseholdActivity } from '@family/contracts';
import { api } from '../api';

export const ACTIVITY_MODULE_EMOJI: Record<ActivityModule, string> = {
  member: '👤',
  invitation: '✉️',
  menu: '🍲',
  calendar: '📅',
  task: '✅',
  poll: '🗳️',
  reminder: '🔔',
  shopping: '🛒',
  inventory: '📦',
  recipe: '📖',
  media: '🎬',
  guest: '🧑‍🤝‍🧑',
  asset: '🔧',
  points: '🎁',
  knowledge: '📚',
  memory: '📷',
  travel: '✈️',
  finance: '💰',
  system: '⚙️',
};

/** 活动流是审计流水 + 菜单事件合流，后端按时间倒序，最多 100 条，没有分页。 */
export function useActivities(scope: 'all' | 'members' | 'menus') {
  return useQuery({
    queryKey: ['activities', scope],
    queryFn: () => api<HouseholdActivity[]>(`/activities?scope=${scope}&limit=100`),
  });
}

/** 今天/昨天说人话，再往前按「9月18日 周五」。 */
export function activityDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (sameDay(date, today)) return '今天';
  if (sameDay(date, yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

export function activityTimeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
