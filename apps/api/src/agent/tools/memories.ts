import { z } from 'zod';
import { defineTool, limited, type AgentToolDeps } from './context';

export const getRecentMemoriesTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_recent_memories',
    description: '读取最近家庭回忆的非敏感摘要',
    kind: 'read',
    schema: z.object({
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute({ user }, input) {
      const rows = await deps.facades.get('memories').listRecent(limited(input.limit), user);
      return rows.map((memory) => ({
        id: memory.id,
        title: memory.title,
        happenedOn: memory.happenedOn,
        category: memory.category,
        tags: memory.tags,
        targetPath: `/memories?memoryId=${memory.id}`,
        untrustedContent: true,
      }));
    },
  });
