// 回忆（J1.1）。
import type { PluginManifest } from './types';

export const memoriesManifest = {
  key: 'memories',
  name: '回忆',
  glyph: '忆',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'memories', label: '回忆', glyph: '忆', scene: 'life', path: '/life/memories' }],
  legacyPaths: [['/memories', '/life/memories']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'family_memories' }] } },
  events: {
    routes: [{ prefix: '/memories' }],
    queryKeys: ['memories'],
  },
  actions: [
    { id: 'memories.record', label: '记一条回忆', keywords: ['值得记住'], deepLink: '/life/memories?create=1' },
  ],
  queries: [
    { id: 'memories.recent', label: '最近的家庭回忆', server: 'memories.recent', legacyTool: 'get_recent_memories' },
  ],
  usage: { label: '回忆', activityModules: ['memory'] },
} as const satisfies PluginManifest;
