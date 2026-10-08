import { z } from 'zod';
import { defineTool, type AgentToolDeps } from './context';

export const proposeReminderTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_reminder',
    description: '为现有家庭事项生成提醒提案',
    kind: 'propose',
    schema: z.object({
      sourceModule: z.enum([
        'menu',
        'task',
        'calendar',
        'poll',
        'maintenance',
        'travel',
      ]),
      sourceId: z.string().uuid(),
      occurrenceDate: z.string().nullable().optional(),
      remindAt: z.string(),
      recipientIds: z.array(z.string().uuid()).min(1).max(20),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_reminder', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
