import { z } from 'zod';
import {
  archivedResponse,
  dateOnly,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/tasks/tasks.module.ts 与 docs/m3-tasks-acceptance.md

export const TASK_RECURRENCES = ['once', 'daily', 'weekly', 'monthly'] as const;
export const taskRecurrence = z.enum(TASK_RECURRENCES);
export type TaskRecurrence = z.infer<typeof taskRecurrence>;

export const TASK_INSTANCE_STATUSES = ['pending', 'done', 'skipped'] as const;
export const taskInstanceStatus = z.enum(TASK_INSTANCE_STATUSES);
export type TaskInstanceStatus = z.infer<typeof taskInstanceStatus>;

export const householdTaskSchema = z
  .object({
    id: uuid,
    title: z.string(),
    note: z.string().nullable(),
    startsOn: dateOnly,
    recurrence: taskRecurrence,
    repeatInterval: z.number().int(),
    endsOn: dateOnly.nullable(),
    createdById: uuid,
    createdBy: memberSchema,
    defaultAssigneeId: uuid.nullable(),
    defaultAssignee: memberSchema.nullable(),
    rewardPoints: z.number().int(),
    isArchived: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .loose();
export type HouseholdTask = z.infer<typeof householdTaskSchema>;

export const taskOccurrenceSchema = z
  .object({
    id: z.string(),
    taskId: uuid,
    dueDate: dateOnly,
    status: taskInstanceStatus,
    assigneeId: uuid.nullable(),
    assignee: memberSchema.nullable(),
    resolvedById: uuid.nullable(),
    resolvedBy: memberSchema.nullable(),
    resolvedAt: nullableDateTime,
    canManageTask: z.boolean(),
    canUpdate: z.boolean(),
    pointsAwarded: z.boolean(),
    task: householdTaskSchema,
  })
  .loose();
export type TaskOccurrence = z.infer<typeof taskOccurrenceSchema>;

export const taskRangeQuery = z.object({
  start: dateOnly,
  end: dateOnly,
});
export type TaskRangeQuery = z.infer<typeof taskRangeQuery>;

export const createTaskBody = z.object({
  title: z.string().max(120),
  note: z.string().max(1000).nullish(),
  startsOn: dateOnly,
  recurrence: taskRecurrence.optional(),
  repeatInterval: z.number().int().min(1).max(365).optional(),
  endsOn: dateOnly.nullish(),
  defaultAssigneeId: uuid.nullish(),
  rewardPoints: z.number().int().min(0).max(10000).optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBody>;

export const updateTaskBody = createTaskBody
  .partial()
  .extend({ isArchived: z.boolean().optional() });
export type UpdateTaskBody = z.infer<typeof updateTaskBody>;

export const updateTaskInstanceBody = z.object({
  status: taskInstanceStatus.optional(),
  assigneeId: uuid.nullish(),
});
export type UpdateTaskInstanceBody = z.infer<typeof updateTaskInstanceBody>;

export const tasks = {
  list: defineEndpoint({
    method: 'GET',
    path: '/tasks',
    summary: '按日期区间列出任务实例（含周期任务展开）',
    query: taskRangeQuery,
    response: z.array(taskOccurrenceSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/tasks',
    summary: '创建一次性或周期任务',
    body: createTaskBody,
    response: householdTaskSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/tasks/:id',
    summary: '修改任务定义',
    params: z.object({ id: uuid }),
    body: updateTaskBody,
    response: householdTaskSchema,
  }),
  archive: defineEndpoint({
    method: 'DELETE',
    path: '/tasks/:id',
    summary: '停用任务',
    params: z.object({ id: uuid }),
    response: archivedResponse,
  }),
  updateOccurrence: defineEndpoint({
    method: 'PATCH',
    path: '/tasks/:taskId/instances/:dueDate',
    summary: '认领、改派、完成、跳过或恢复某一天的任务实例',
    params: z.object({ taskId: uuid, dueDate: dateOnly }),
    body: updateTaskInstanceBody,
    response: taskOccurrenceSchema,
  }),
};
