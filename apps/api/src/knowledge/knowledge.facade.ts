import type { KnowledgeFacade } from '@family/contracts';
import type { KnowledgeService } from './knowledge.module';

/** 知识库门面的实现（J4.1，接口见 contracts/plugins/knowledge.facade.ts），KnowledgeModule 启动时注册。 */
export function knowledgeFacade(knowledge: KnowledgeService): KnowledgeFacade {
  return {
    searchArticles: (query, actor) =>
      knowledge.list({ status: 'active', q: query.q, limit: query.limit }, actor),
  };
}
