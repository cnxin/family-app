// 知识库门面（J4.1）：实现在 apps/api/src/knowledge/knowledge.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（search_knowledge）。
import type { PluginActor } from './kernel';

/** 一篇知识（小管家用到的字段）。 */
export interface KnowledgeArticleView {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  tags: string[];
  referenceUrl: string | null;
}

export interface KnowledgeFacade {
  /** 与 GET /knowledge?status=active&q&limit 同一个实现（标题、摘要、标签里找）。 */
  searchArticles(query: { q?: string; limit: number }, actor: PluginActor): Promise<KnowledgeArticleView[]>;
}
