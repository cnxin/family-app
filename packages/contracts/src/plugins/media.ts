// 观影（J1.6）。片单、片库（Plex / Emby）、观看记录、MoviePilot 求片；没有跨插件 Service import。
// 观影投票写的是投票插件的数据（polls 路由推 media），访客邀请里的观影投票登记在 guests.ts，都属跨插件引用（J1b）。
// 财务流水的 sourceType 'media_subscription'、日历条目来源图标是业务数据引用，不在这里。
// ⌘K 还没有观影动作（§8.2 缺项，J3 补）。
import type { PluginManifest } from './types';

export const mediaManifest = {
  key: 'media',
  name: '观影',
  glyph: '影',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'media', label: '观影', glyph: '影', scene: 'life', path: '/life/media' }],
  // 子页面的旧路径要排在 /media 之前（前缀匹配取第一条）
  legacyPaths: [
    ['/media/library', '/life/media/library'],
    ['/media/history', '/life/media/history'],
    ['/media/watchlist', '/life/media/watchlist'],
    ['/media/settings', '/life/media/settings'],
    ['/media', '/life/media'],
  ],
  module: {
    overridable: true,
    // 片单里有片，或者家里配过片库 / 求片连接、元数据源
    hasData: {
      kind: 'tables',
      tables: [
        { table: 'household_media' },
        { table: 'integrations', where: `kind IN ('plex', 'emby', 'moviepilot') AND NULLIF("baseUrl", '') IS NOT NULL` },
        { table: 'household_media_source_configs', where: `(NULLIF("baseUrl", '') IS NOT NULL OR NULLIF("credentialHint", '') IS NOT NULL)` },
      ],
    },
  },
  events: {
    routes: [
      { prefix: '/media' },
      // MoviePilot 回调，没有登录用户，服务端显式发
      { prefix: '/media/webhooks', emit: 'explicit' },
    ],
    exempt: [
      {
        prefix: '/media/library-availability',
        reason: '只读查询（POST 只为带 id 列表）；发 media 会让片单页失效重查、再发事件，自己转起来',
      },
    ],
    queryKeys: [
      'media', 'media-requests', 'media-library', 'media-library-availability', 'media-connectors',
      'media-connector-settings', 'media-metadata-sources', 'media-playback-users', 'viewing-sessions',
    ],
  },
  queries: [
    { id: 'media.watch-candidates', label: '片单里能看的', server: 'media.watch-candidates', legacyTool: 'get_watch_candidates' },
  ],
  settingsRows: [
    {
      title: '观影连接',
      hint: 'Plex、Emby 这些片库怎么接进来',
      path: '/life/media/settings',
      status: { server: 'media.connectorCount' },
      managerOnly: true,
    },
  ],
  usage: { label: '观影', activityModules: ['media'] },
  notifications: [{ key: 'media', label: '观影', icon: '🎬' }],
} as const satisfies PluginManifest;
