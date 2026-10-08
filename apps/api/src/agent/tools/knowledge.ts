import { z } from 'zod';
import { defineTool, limited, type AgentToolDeps } from './context';

export const searchKnowledgeTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'search_knowledge',
    description: '搜索家庭知识库的标题与摘要。用户以“这篇文章”“这条知识”等词指代单个知识条目、但既无具体标题也无页面上下文时，不得猜测条目或调用无条件搜索，应先追问具体文章；“搜索关于报销的资料”等范围查询应直接调用本工具',
    kind: 'read',
    schema: z.object({
      query: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute({ user }, input) {
      const query = typeof input.query === 'string' ? input.query.trim().slice(0, 80) : '';
      const rows = await deps.facades
        .get('knowledge')
        .searchArticles({ q: query || undefined, limit: limited(input.limit) }, user);
      return rows.map((article) => ({
        id: article.id,
        title: article.title,
        category: article.category,
        summary: article.summary?.slice(0, 300) ?? null,
        tags: article.tags,
        referenceUrl: article.referenceUrl,
        targetPath: `/knowledge?articleId=${article.id}`,
        untrustedContent: true,
      }));
    },
  });
