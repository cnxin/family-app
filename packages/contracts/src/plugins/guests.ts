// 访客（J1.3）。来访会写日历、点菜；访客公开页（凭邀请令牌，没有登录用户）的写入由服务端显式发事件。
// 观影投票挂在访客邀请下，写的是观影和投票的数据，属跨插件引用（J1b）。
import type { PluginManifest } from './types';

export const guestsManifest = {
  key: 'guests',
  name: '访客',
  glyph: '客',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'guests', label: '访客', glyph: '客', scene: 'house', path: '/house/guests' }],
  legacyPaths: [['/guests', '/house/guests']],
  module: {
    overridable: true,
    hasData: { kind: 'tables', tables: [{ table: 'guests' }, { table: 'visits' }] },
  },
  events: {
    routes: [
      { prefix: '/guests' },
      { prefix: '/visits', domains: ['guests', 'calendar', 'menus'] },
      { prefix: '/guest-wifi-profiles' },
      { prefix: '/guest-meal-requests', domains: ['guests', 'menus'] },
      { prefix: '/guest-invitations' },
      { prefix: '/guest-invitations/:token/response', emit: 'explicit' },
      { prefix: '/guest-invitations/:token/meal-requests', emit: 'explicit' },
      { prefix: '/guest-invitations/:token/meal-options', emit: 'explicit' },
      { prefix: '/guest-invitations/:token/movie-polls', domains: ['guests', 'media', 'polls'], emit: 'explicit' },
    ],
    queryKeys: [
      'guests', 'visits', 'guest-wifi-profiles', 'guest-meal-requests',
      'guest-invitation', 'guest-meal-options', 'guest-movie-polls',
    ],
  },
  attention: {
    label: '访客',
    actionLabel: '去点菜',
    listActionLabel: '去处理',
    path: '/house/guests',
    order: 2,
    mergedTitle: '本周有 {n} 场来访要准备',
    mixedTitle: '{n} 件访客的事要处理',
    kinds: [
      {
        kind: 'menu',
        server: 'guests.menu',
        actionLabel: '去点菜',
        // 来访记录没有餐次，默认晚餐；点菜页读到 date 后会把参数抹掉
        path: '/eat/order?date={dueOn}&mealType=dinner',
        title: '{name}（{soon}）还没定菜',
        titleNoDue: '{name}（快到了）还没定菜',
      },
      {
        kind: 'meal-request',
        server: 'guests.meal-request',
        actionLabel: '去处理',
        capability: 'manage_guests',
        title: '{name}的点菜请求等你处理',
        mergedTitle: '{n} 条访客点菜等你处理',
      },
    ],
  },
  actions: [
    { id: 'guests.create-visit', label: '加个来访', keywords: ['访客'], deepLink: '/house/guests?create=1' },
  ],
  usage: { label: '访客', activityModules: ['guest'] },
  notifications: [{ key: 'guest', label: '访客', icon: '👋' }],
  capabilities: [{ key: 'manage_guests', roles: ['owner', 'admin'] }],
} as const satisfies PluginManifest;
