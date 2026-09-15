import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  removedResponse,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/calendar/calendar.module.ts 与 docs/m3-calendar-acceptance.md

/** 统一日历聚合的来源模块。 */
export const CALENDAR_MODULES = [
  'menu',
  'calendar',
  'task',
  'media',
  'guest',
  'maintenance',
  'travel',
] as const;
export const calendarModule = z.enum(CALENDAR_MODULES);
export type CalendarModule = z.infer<typeof calendarModule>;

/**
 * 日历条目的状态是各来源模块状态的并集：
 * menu open/done、task pending/done/skipped、calendar/maintenance scheduled、
 * guest scheduled/cancelled/completed、travel planned/completed/cancelled、media 片单六态。
 */
export const CALENDAR_ENTRY_STATUSES = [
  'open',
  'done',
  'scheduled',
  'pending',
  'skipped',
  'cancelled',
  'completed',
  'planned',
  'watchlist',
  'voting',
  'watching',
  'dropped',
] as const;
export const calendarEntryStatus = z.enum(CALENDAR_ENTRY_STATUSES);
export type CalendarEntryStatus = z.infer<typeof calendarEntryStatus>;

export const calendarEntryMetadataSchema = z
  .object({
    mealType: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
    itemCount: z.number().int().optional(),
    createdById: uuid.optional(),
    createdByName: z.string().optional(),
    canManage: z.boolean().optional(),
    canUpdate: z.boolean().optional(),
    assigneeId: uuid.nullable().optional(),
    assigneeName: z.string().nullable().optional(),
    recurrence: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    mediaType: z.enum(['movie', 'series']).optional(),
    year: z.number().int().nullable().optional(),
    hostMemberId: uuid.optional(),
    hostMemberName: z.string().optional(),
    guestCount: z.number().int().optional(),
    assetId: uuid.optional(),
    assetName: z.string().optional(),
    frequencyDays: z.number().int().optional(),
    endDate: dateOnly.optional(),
    destination: z.string().nullable().optional(),
    completedItems: z.number().int().optional(),
    totalItems: z.number().int().optional(),
  })
  .loose();
export type CalendarEntryMetadata = z.infer<typeof calendarEntryMetadataSchema>;

export const calendarEntrySchema = z
  .object({
    id: z.string(),
    sourceId: uuid,
    module: calendarModule,
    date: dateOnly,
    startsAt: nullableDateTime,
    endsAt: nullableDateTime,
    title: z.string(),
    summary: z.string().nullable(),
    status: calendarEntryStatus,
    targetPath: z.string(),
    metadata: calendarEntryMetadataSchema,
  })
  .loose();
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

/** 家庭事件实体。create/update 直接回传 save 结果，createdBy 可能未加载。 */
export const calendarEventSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    date: dateOnly,
    startsAt: nullableDateTime,
    endsAt: nullableDateTime,
    title: z.string(),
    note: z.string().nullable(),
    createdById: uuid,
    createdBy: memberSchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarRangeQuery = z.object({
  start: dateOnly,
  end: dateOnly,
});
export type CalendarRangeQuery = z.infer<typeof calendarRangeQuery>;

export const createCalendarEventBody = z.object({
  date: dateOnly,
  startsAt: isoDateOrDateTime.nullish(),
  endsAt: isoDateOrDateTime.nullish(),
  title: z.string().max(120),
  note: z.string().max(1000).nullish(),
});
export type CreateCalendarEventBody = z.infer<typeof createCalendarEventBody>;

export const updateCalendarEventBody = createCalendarEventBody.partial();
export type UpdateCalendarEventBody = z.infer<typeof updateCalendarEventBody>;

export const calendar = {
  list: defineEndpoint({
    method: 'GET',
    path: '/calendar',
    summary: '按日期区间聚合菜单、家庭事件、任务、观影排期、来访、资产维护与出行',
    query: calendarRangeQuery,
    response: z.array(calendarEntrySchema),
  }),
  createEvent: defineEndpoint({
    method: 'POST',
    path: '/calendar-events',
    summary: '创建家庭事件',
    body: createCalendarEventBody,
    response: calendarEventSchema,
  }),
  updateEvent: defineEndpoint({
    method: 'PATCH',
    path: '/calendar-events/:id',
    summary: '修改家庭事件（仅创建者或管理员）',
    params: idParams,
    body: updateCalendarEventBody,
    response: calendarEventSchema,
  }),
  removeEvent: defineEndpoint({
    method: 'DELETE',
    path: '/calendar-events/:id',
    summary: '删除家庭事件',
    params: idParams,
    response: removedResponse,
  }),
};
