// 知识库（J1.1）。
import type { PluginManifest } from './types';

export const knowledgeManifest = {
  key: 'knowledge',
  name: '知识库',
  glyph: '知',
  manifestVersion: 1,
  tier: 'shelf',
  nav: [{ key: 'knowledge', label: '知识库', glyph: '知', scene: 'life', path: '/life/knowledge' }],
  legacyPaths: [['/knowledge', '/life/knowledge']],
  module: { overridable: true, hasData: { kind: 'tables', tables: [{ table: 'knowledge_articles' }] } },
  events: {
    routes: [{ prefix: '/knowledge-articles' }],
    queryKeys: ['knowledge', 'knowledge-revisions'],
  },
  actions: [
    { id: 'knowledge.write', label: '写一篇说明', keywords: ['经验'], deepLink: '/life/knowledge?create=1' },
  ],
  queries: [
    { id: 'knowledge.search', label: '搜家里的知识库', server: 'knowledge.search', legacyTool: 'search_knowledge' },
  ],
  usage: { label: '知识库', activityModules: ['knowledge'] },
} as const satisfies PluginManifest;
