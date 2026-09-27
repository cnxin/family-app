import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/activities/activities.module.ts（家庭活动审计 + 菜单事件合流）

export const ACTIVITY_MODULES = [
  'member',
  'invitation',
  'menu',
  'calendar',
  'task',
  'poll',
  'reminder',
  'shopping',
  'inventory',
  'recipe',
  'media',
  'guest',
  'asset',
  'points',
  'knowledge',
  'memory',
  'travel',
  'finance',
  'system',
] as const;
export const activityModule = z.enum(ACTIVITY_MODULES);
export type ActivityModule = z.infer<typeof activityModule>;

export const householdActivitySchema = z
  .object({
    /** `activity:<uuid>` 或 `menu:<uuid>` */
    id: z.string(),
    module: activityModule,
    action: z.string(),
    summary: z.string(),
    detail: z.string().nullable(),
    actor: z.object({
      id: uuid.nullable(),
      name: z.string(),
      avatarEmoji: z.string(),
    }),
    subjectMemberId: uuid.nullable(),
    targetPath: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    occurredAt: isoDateTime,
  });
export type HouseholdActivity = z.infer<typeof householdActivitySchema>;

export const activityListQuery = z.object({
  scope: z.enum(['all', 'members', 'menus']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const activities = {
  list: defineEndpoint({
    method: 'GET',
    path: '/activities',
    summary: '家庭活动流（审计流水 + 菜单事件，按时间倒序）',
    query: activityListQuery,
    response: z.array(householdActivitySchema),
  }),
};
