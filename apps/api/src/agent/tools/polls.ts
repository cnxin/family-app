import { z } from 'zod';
import { defineTool, type AgentToolDeps } from './context';

export const proposePollTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_poll',
    description: '生成家庭投票提案',
    kind: 'propose',
    schema: z.object({
      title: z.string().min(1).max(120),
      description: z.string().max(1000).nullable().optional(),
      category: z
        .enum(['general', 'meal', 'activity', 'movie', 'shopping'])
        .optional(),
      voteMode: z.enum(['single', 'multiple']).optional(),
      maxChoices: z.number().int().min(1).max(12).optional(),
      closesAt: z.string().nullable().optional(),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(120),
            description: z.string().max(500).nullable().optional(),
          }),
        )
        .min(2)
        .max(12),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_poll', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
