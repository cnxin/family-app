import { z } from 'zod';
import { PlainDate, uuid } from './common';
import { defineEndpoint } from './registry';

export const attentionItemSchema = z.object({
  key: z.string().min(1),
  domain: z.enum(['assets', 'guests', 'travel', 'inventory', 'polls', 'points', 'finance', 'backups', 'smart-home']),
  kind: z.string().min(1),
  /** 合并进这一张卡的全部 kind，顺序与服务端排序一致，至少包含 kind。 */
  kinds: z.array(z.string().min(1)).min(1),
  count: z.number().int().positive(),
  dueOn: PlainDate.optional(),
  overdue: z.boolean(),
  entity: z.object({ id: uuid, name: z.string().min(1) }).optional(),
}).superRefine((item, context) => {
  if (!item.kinds.includes(item.kind)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kinds'],
      message: 'kinds 必须包含 kind',
    });
  }
  if (item.count === 1 && !item.entity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entity'],
      message: 'count 为 1 时必须带 entity',
    });
  }
  if (item.count > 1 && item.entity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entity'],
      message: 'count 大于 1 时不能带 entity',
    });
  }
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const todayAttentionSchema = z.object({
  today: PlainDate,
  items: z.array(attentionItemSchema),
});
export type TodayAttention = z.infer<typeof todayAttentionSchema>;

export const today = {
  attention: defineEndpoint({
    method: 'GET',
    path: '/today/attention',
    summary: '今天页需要留意：按家庭日期聚合低频域待办',
    response: todayAttentionSchema,
  }),
};
