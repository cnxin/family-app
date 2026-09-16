import { z } from 'zod';
import {
  archivedResponse,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { householdMediaStatus, mediaType } from './media';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/polls/polls.module.ts 与 docs/m3-polls-acceptance.md

export const POLL_CATEGORIES = [
  'general',
  'meal',
  'activity',
  'movie',
  'shopping',
] as const;
export const pollCategory = z.enum(POLL_CATEGORIES);
export type PollCategory = z.infer<typeof pollCategory>;

export const POLL_VOTE_MODES = ['single', 'multiple'] as const;
export const pollVoteMode = z.enum(POLL_VOTE_MODES);
export type PollVoteMode = z.infer<typeof pollVoteMode>;

export const POLL_STATUSES = ['open', 'closed'] as const;
export const pollStatus = z.enum(POLL_STATUSES);
export type PollStatus = z.infer<typeof pollStatus>;

/** 片单条目在投票选项里的精简投影：只 join 了 mediaTitle 的几列，没有 overview / externalRefs。 */
export const pollOptionMediaSchema = z
  .object({
    id: uuid,
    status: householdMediaStatus,
    mediaTitle: z
      .object({
        id: uuid,
        type: mediaType,
        title: z.string(),
        originalTitle: z.string().nullable(),
        year: z.number().int().nullable(),
        posterUrl: z.string().nullable(),
      }),
  });

export const pollOptionResultSchema = z
  .object({
    id: uuid,
    label: z.string(),
    description: z.string().nullable(),
    mediaId: uuid.nullable(),
    media: pollOptionMediaSchema.nullable(),
    sortOrder: z.number().int(),
    voteCount: z.number().int(),
    percentage: z.number(),
    voters: z.array(memberSchema),
  });
export type PollOptionResult = z.infer<typeof pollOptionResultSchema>;

export const householdPollSchema = z
  .object({
    id: uuid,
    title: z.string(),
    description: z.string().nullable(),
    category: pollCategory,
    voteMode: pollVoteMode,
    maxChoices: z.number().int(),
    closesAt: nullableDateTime,
    status: pollStatus,
    sourceModule: z.string().nullable(),
    sourceId: z.string().nullable(),
    createdById: uuid,
    createdBy: memberSchema,
    closedById: uuid.nullable(),
    closedBy: memberSchema.nullable(),
    closedAt: nullableDateTime,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    canManage: z.boolean(),
    canVote: z.boolean(),
    totalVoters: z.number().int(),
    totalVotes: z.number().int(),
    selectedOptionIds: z.array(uuid),
    options: z.array(pollOptionResultSchema),
  });
export type HouseholdPoll = z.infer<typeof householdPollSchema>;

export const pollListQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).optional(),
});
export type PollListQuery = z.infer<typeof pollListQuery>;

export const pollOptionInput = z.object({
  label: z.string().max(120).optional(),
  description: z.string().max(500).nullish(),
  mediaId: uuid.optional(),
});
export type PollOptionInput = z.infer<typeof pollOptionInput>;

export const createPollBody = z.object({
  title: z.string().max(120),
  description: z.string().max(1000).nullish(),
  category: pollCategory.optional(),
  voteMode: pollVoteMode.optional(),
  maxChoices: z.number().int().min(1).max(12).optional(),
  closesAt: isoDateOrDateTime.nullish(),
  options: z.array(pollOptionInput).min(2).max(12),
  sourceModule: z.literal('media').optional(),
  sourceId: uuid.optional(),
});
export type CreatePollBody = z.infer<typeof createPollBody>;

export const updatePollBody = createPollBody
  .omit({ sourceModule: true, sourceId: true })
  .partial();
export type UpdatePollBody = z.infer<typeof updatePollBody>;

export const voteBody = z.object({
  optionIds: z.array(uuid).max(12),
});
export type VoteBody = z.infer<typeof voteBody>;

export const polls = {
  list: defineEndpoint({
    method: 'GET',
    path: '/polls',
    summary: '列出家庭投票',
    query: pollListQuery,
    response: z.array(householdPollSchema),
  }),
  get: defineEndpoint({
    method: 'GET',
    path: '/polls/:id',
    summary: '查看单个投票及结果',
    params: idParams,
    response: householdPollSchema,
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/polls',
    summary: '发起投票',
    body: createPollBody,
    response: householdPollSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/polls/:id',
    summary: '修改投票（尚无人投票时可改选项）',
    params: idParams,
    body: updatePollBody,
    response: householdPollSchema,
  }),
  vote: defineEndpoint({
    method: 'POST',
    path: '/polls/:id/votes',
    summary: '投票、改票或撤票（空数组）',
    params: idParams,
    body: voteBody,
    response: householdPollSchema,
  }),
  close: defineEndpoint({
    method: 'POST',
    path: '/polls/:id/close',
    summary: '提前结束投票',
    params: idParams,
    response: householdPollSchema,
  }),
  reopen: defineEndpoint({
    method: 'POST',
    path: '/polls/:id/reopen',
    summary: '重开已结束的投票',
    params: idParams,
    response: householdPollSchema,
  }),
  archive: defineEndpoint({
    method: 'DELETE',
    path: '/polls/:id',
    summary: '归档投票',
    params: idParams,
    response: archivedResponse,
  }),
};
