import { z } from 'zod';
import { defineTool, MAX_RESULT_ITEMS, type AgentToolDeps } from './context';

/** J4 第四批：进行中或已结束的投票，带每个选项的票数和截止时间。 */
export const getPollsTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_polls',
    description: '读取家庭投票：进行中（status=open，默认）或已结束（status=closed）的投票标题、每个选项的票数、截止时间，以及当前成员投过没有。回答投票进展前调用本工具。',
    kind: 'read',
    schema: z.object({
      status: z.enum(['open', 'closed']).optional(),
    }),
    async execute({ user }, input) {
      const status = input.status === 'closed' ? 'closed' : 'open';
      const polls = await deps.facades.get('polls').listPolls(status, user);
      return polls.slice(0, MAX_RESULT_ITEMS).map((poll) => ({
        title: poll.title,
        status: poll.status,
        closesAt: poll.closesAt ? new Date(poll.closesAt).toISOString() : null,
        totalVoters: poll.totalVoters,
        voted: poll.selectedOptionIds.length > 0,
        options: poll.options.map((option) => ({ label: option.label, votes: option.voteCount })),
        targetPath: `/schedule/polls?pollId=${poll.id}`,
      }));
    },
  });

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
