import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { CALENDAR_ENTRY_STATUSES } from './calendar';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/reminders/reminders.module.ts 与 docs/m3-reminders-acceptance.md

export const REMINDER_SOURCE_MODULES = [
  'menu',
  'task',
  'calendar',
  'poll',
  'maintenance',
  'travel',
] as const;
export const reminderSourceModule = z.enum(REMINDER_SOURCE_MODULES);
export type ReminderSourceModule = z.infer<typeof reminderSourceModule>;

export const REMINDER_STATUSES = ['scheduled', 'sent', 'cancelled'] as const;
export const reminderStatus = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof reminderStatus>;

/**
 * 提醒关联事项的状态：日历条目状态的并集，再加投票的 `closed`
 * （提醒挂在已结束/归档/过期的投票上时，resolveSource 返回 status: 'closed'；
 * 日历本身不产出这个值，所以不放进 CALENDAR_ENTRY_STATUSES）。
 */
export const REMINDER_SOURCE_STATUSES = [
  ...CALENDAR_ENTRY_STATUSES,
  'closed',
] as const;
export const reminderSourceStatus = z.enum(REMINDER_SOURCE_STATUSES);
export type ReminderSourceStatus = z.infer<typeof reminderSourceStatus>;

/** 可被提醒的事项（来自日历条目、开放投票或启用的维护计划）。 */
export const reminderSourceSchema = z
  .object({
    module: reminderSourceModule,
    sourceId: uuid,
    occurrenceDate: dateOnly.nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    date: dateOnly.nullable(),
    startsAt: nullableDateTime,
    targetPath: z.string(),
    status: reminderSourceStatus,
  })
  .loose();
export type ReminderSource = z.infer<typeof reminderSourceSchema>;

export const reminderRecipientSchema = z
  .object({
    id: uuid,
    member: memberSchema,
    deliveredAt: nullableDateTime,
  })
  .loose();
export type ReminderRecipient = z.infer<typeof reminderRecipientSchema>;

export const householdReminderSchema = z
  .object({
    id: uuid,
    sourceModule: reminderSourceModule,
    sourceId: uuid,
    occurrenceDate: dateOnly.nullable(),
    remindAt: isoDateTime,
    status: reminderStatus,
    source: reminderSourceSchema.nullable(),
    createdById: uuid,
    createdBy: memberSchema,
    recipients: z.array(reminderRecipientSchema),
    sentAt: nullableDateTime,
    cancelledAt: nullableDateTime,
    cancelReason: z.string().nullable(),
    canManage: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type HouseholdReminder = z.infer<typeof householdReminderSchema>;

export const reminderSourceRangeQuery = z.object({
  start: dateOnly,
  end: dateOnly,
});

export const reminderListQuery = z.object({
  status: z.enum([...REMINDER_STATUSES, 'all']).optional(),
});
export type ReminderListQuery = z.infer<typeof reminderListQuery>;

export const createReminderBody = z.object({
  sourceModule: reminderSourceModule,
  sourceId: uuid,
  occurrenceDate: dateOnly.nullish(),
  remindAt: isoDateOrDateTime,
  recipientIds: z.array(uuid).min(1).max(20),
});
export type CreateReminderBody = z.infer<typeof createReminderBody>;

export const updateReminderBody = z.object({
  remindAt: isoDateOrDateTime.optional(),
  recipientIds: z.array(uuid).min(1).max(20).optional(),
});
export type UpdateReminderBody = z.infer<typeof updateReminderBody>;

export const reminders = {
  listSources: defineEndpoint({
    method: 'GET',
    path: '/reminder-sources',
    summary: '列出日期区间内可设置提醒的事项',
    query: reminderSourceRangeQuery,
    response: z.array(reminderSourceSchema),
  }),
  list: defineEndpoint({
    method: 'GET',
    path: '/reminders',
    summary: '列出提醒（默认只看未发送）',
    query: reminderListQuery,
    response: z.array(householdReminderSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/reminders',
    summary: '为事项创建定时提醒并指定接收人',
    body: createReminderBody,
    response: householdReminderSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/reminders/:id',
    summary: '修改未发送提醒的时间或接收人',
    params: idParams,
    body: updateReminderBody,
    response: householdReminderSchema,
  }),
  cancel: defineEndpoint({
    method: 'DELETE',
    path: '/reminders/:id',
    summary: '取消提醒（幂等，已取消时直接返回）',
    params: idParams,
    response: householdReminderSchema,
  }),
};
