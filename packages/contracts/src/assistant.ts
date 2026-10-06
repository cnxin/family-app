import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/assistant/assistant-utterances.module.ts（J2，docs/architecture.md §2.3、§4 J2）。
//
// 助理原话：⌘K、今天页搜索条、小管家对话每「一次输入结束」记一条——原话、从哪个入口来、命中哪一档哪个意图、
// 最后怎么结束（点了哪条）。这是第 0 档模板迭代与评测集的唯一数据源，只存本地库，不出网。
// 助理层不是插件（§3.1）：路由不推事件、不进动态流水、不进通知。

export const ASSISTANT_UTTERANCE_SOURCES = ['command_palette', 'today_search', 'agent_chat'] as const;
export const assistantUtteranceSource = z.enum(ASSISTANT_UTTERANCE_SOURCES);
export type AssistantUtteranceSource = z.infer<typeof assistantUtteranceSource>;

/**
 * 一次输入怎么结束：navigated 点了某条；proposed 生成了提案（J3 起）；candidates 有候选但没点就关了；
 * no_match 没有候选；dismissed 输过字又全删掉再关。
 */
export const ASSISTANT_UTTERANCE_OUTCOMES = ['navigated', 'proposed', 'candidates', 'no_match', 'dismissed'] as const;
export const assistantUtteranceOutcome = z.enum(ASSISTANT_UTTERANCE_OUTCOMES);
export type AssistantUtteranceOutcome = z.infer<typeof assistantUtteranceOutcome>;

/** 点的那条是什么：⌘K 的动作 / 页面 / 菜品 / 东西，或交给小管家。J3 拿它当人工标注。 */
export const ASSISTANT_UTTERANCE_CHOSEN_KINDS = ['action', 'page', 'dish', 'item', 'agent'] as const;
export const assistantUtteranceChosenKind = z.enum(ASSISTANT_UTTERANCE_CHOSEN_KINDS);
export type AssistantUtteranceChosenKind = z.infer<typeof assistantUtteranceChosenKind>;

const intentId = z.string().trim().min(1).max(80);

export const createAssistantUtteranceBody = z
  .object({
    /** 前端打开面板时生成；同一家、同一人、同一个 clientId 重复提交返回同一条。 */
    clientId: uuid,
    text: z.string().trim().min(1).max(200),
    source: assistantUtteranceSource,
    outcome: assistantUtteranceOutcome,
    chosenKind: assistantUtteranceChosenKind.nullable().optional(),
    chosenId: z.string().trim().min(1).max(120).nullable().optional(),
    /** 下面四个 J3 起由引擎填；J2 前端一律不传。 */
    tier: z.number().int().min(0).max(2).nullable().optional(),
    intentId: intentId.nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    correctedIntentId: intentId.nullable().optional(),
  })
  .strict()
  .refine((body) => body.outcome !== 'navigated' || Boolean(body.chosenKind), {
    message: '点了某条（navigated）时要带上 chosenKind',
    path: ['chosenKind'],
  });
export type CreateAssistantUtteranceBody = z.infer<typeof createAssistantUtteranceBody>;

export const assistantUtteranceSchema = z.object({
  id: uuid,
  memberId: uuid,
  /** 说话的人现在的名字；成员已删时为 null。 */
  memberName: z.string().nullable(),
  text: z.string(),
  source: assistantUtteranceSource,
  tier: z.number().int().nullable(),
  intentId: z.string().nullable(),
  confidence: z.number().nullable(),
  outcome: assistantUtteranceOutcome,
  chosenKind: assistantUtteranceChosenKind.nullable(),
  chosenId: z.string().nullable(),
  correctedIntentId: z.string().nullable(),
  createdAt: isoDateTime,
});
export type AssistantUtterance = z.infer<typeof assistantUtteranceSchema>;

/** 列表与导出的筛选。成员（没有 manage_agent）只能看自己的：memberId 不传或传自己。 */
export const assistantUtteranceFilterQuery = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  source: assistantUtteranceSource.optional(),
  outcome: assistantUtteranceOutcome.optional(),
  memberId: uuid.optional(),
});
export type AssistantUtteranceFilterQuery = z.infer<typeof assistantUtteranceFilterQuery>;

export const assistantUtteranceListQuery = assistantUtteranceFilterQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** 上一页最后一条的游标（倒序，按创建时间 + id）。 */
  cursor: z.string().max(200).optional(),
});
export type AssistantUtteranceListQuery = z.infer<typeof assistantUtteranceListQuery>;

export const assistantUtterancePageSchema = z.object({
  items: z.array(assistantUtteranceSchema),
  nextCursor: z.string().nullable(),
});
export type AssistantUtterancePage = z.infer<typeof assistantUtterancePageSchema>;

export const clearAssistantUtterancesQuery = z.object({ memberId: z.literal('me') });

export const assistantUtteranceDeletedSchema = z.object({ deleted: z.number().int() });

export const assistant = {
  createUtterance: defineEndpoint({
    method: 'POST',
    path: '/assistant/utterances',
    summary: '记一条助理原话（任意家庭成员，clientId 幂等；不推事件）',
    body: createAssistantUtteranceBody,
    response: assistantUtteranceSchema,
  }),
  listUtterances: defineEndpoint({
    method: 'GET',
    path: '/assistant/utterances',
    summary: '原话列表，倒序游标分页（manage_agent 看全家；成员只看自己）',
    query: assistantUtteranceListQuery,
    response: assistantUtterancePageSchema,
  }),
  exportUtterances: defineEndpoint({
    method: 'GET',
    path: '/assistant/utterances/export.csv',
    summary: '按同样筛选导出 CSV（UTF-8 BOM；manage_agent；文本流，无 JSON 响应）',
    query: assistantUtteranceFilterQuery,
    response: z.undefined(),
  }),
  removeUtterance: defineEndpoint({
    method: 'DELETE',
    path: '/assistant/utterances/:id',
    summary: '删一条原话（本人或 manage_agent）',
    params: z.object({ id: uuid }),
    response: assistantUtteranceDeletedSchema,
  }),
  clearMyUtterances: defineEndpoint({
    method: 'DELETE',
    path: '/assistant/utterances',
    summary: '清掉自己全部原话（memberId=me）',
    query: clearAssistantUtterancesQuery,
    response: assistantUtteranceDeletedSchema,
  }),
};
