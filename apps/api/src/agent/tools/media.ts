import { z } from 'zod';
import { defineTool, limited, type AgentToolDeps } from './context';

export const getWatchCandidatesTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_watch_candidates',
    description: '读取家庭片单中的待看候选',
    kind: 'read',
    schema: z.object({
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute({ user }, input) {
      const rows = await deps.facades.get('media').listWatchlist(user);
      return rows
        .filter((entry) => !['completed', 'dropped'].includes(entry.status))
        .slice(0, limited(input.limit))
        .map((entry) => ({
          id: entry.id,
          title: entry.mediaTitle.title,
          type: entry.mediaTitle.type,
          year: entry.mediaTitle.year,
          status: entry.status,
          scheduledFor: entry.scheduledFor,
          targetPath: `/media?mediaId=${entry.id}`,
        }));
    },
  });
