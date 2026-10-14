import { BadRequestException } from '@nestjs/common';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdTask, HouseholdTaskInstance } from '../entities';
import { isHouseholdManager, parseDateOnly, taskOccursOn } from '@family/shared';
import { type CreateTaskBody, type UpdateTaskBody } from '@family/contracts';

export const DAY_MS = 86_400_000;

function dateString(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function occurrenceDates(task: HouseholdTask, start: string, end: string) {
  const first = Math.max(
    parseDateOnly(start, '开始日期'),
    parseDateOnly(task.startsOn, '任务开始日期'),
  );
  const last = Math.min(
    parseDateOnly(end, '结束日期'),
    task.endsOn ? parseDateOnly(task.endsOn, '任务结束日期') : Number.MAX_SAFE_INTEGER,
  );
  const dates: string[] = [];
  for (let timestamp = first; timestamp <= last; timestamp += DAY_MS) {
    const date = dateString(timestamp);
    if (taskOccursOn(task, date)) dates.push(date);
  }
  return dates;
}

export function normalizeTaskInput(
  dto: CreateTaskBody | UpdateTaskBody,
  current?: HouseholdTask,
) {
  const title = dto.title ?? current?.title;
  const startsOn = dto.startsOn ?? current?.startsOn;
  const recurrence = dto.recurrence ?? current?.recurrence ?? 'once';
  const repeatInterval = dto.repeatInterval ?? current?.repeatInterval ?? 1;
  const note = Object.prototype.hasOwnProperty.call(dto, 'note')
    ? dto.note?.trim() || null
    : current?.note ?? null;
  let endsOn = Object.prototype.hasOwnProperty.call(dto, 'endsOn')
    ? dto.endsOn ?? null
    : current?.endsOn ?? null;

  if (!title?.trim() || !startsOn) {
    throw new BadRequestException('任务名称和开始日期不能为空');
  }
  const startsAt = parseDateOnly(startsOn, '开始日期');
  if (recurrence === 'once') endsOn = null;
  if (endsOn && parseDateOnly(endsOn, '结束日期') < startsAt) {
    throw new BadRequestException('结束日期不能早于开始日期');
  }
  return {
    title: title.trim(),
    startsOn,
    recurrence,
    repeatInterval,
    endsOn,
    note,
  };
}

export function presentOccurrence(
  task: HouseholdTask,
  dueDate: string,
  instance: HouseholdTaskInstance | undefined,
  user: JwtUser,
) {
  const assigneeId = instance?.assigneeId ?? task.defaultAssigneeId;
  const assignee = instance ? instance.assignee : task.defaultAssignee;
  const canManageTask = task.createdById === user.memberId || isHouseholdManager(user);
  return {
    id: instance?.id ?? `task:${task.id}:${dueDate}`,
    taskId: task.id,
    dueDate,
    status: instance?.status ?? ('pending' as const),
    assigneeId,
    assignee,
    resolvedById: instance?.resolvedById ?? null,
    resolvedBy: instance?.resolvedBy ?? null,
    resolvedAt: instance?.resolvedAt?.toISOString() ?? null,
    canManageTask,
    canUpdate:
      canManageTask || assigneeId == null || assigneeId === user.memberId,
    pointsAwarded: Boolean(instance?.pointsLedgerId),
    task: {
      id: task.id,
      title: task.title,
      note: task.note,
      startsOn: task.startsOn,
      recurrence: task.recurrence,
      repeatInterval: task.repeatInterval,
      endsOn: task.endsOn,
      createdById: task.createdById,
      createdBy: task.createdBy,
      defaultAssigneeId: task.defaultAssigneeId,
      defaultAssignee: task.defaultAssignee,
      rewardPoints: task.rewardPoints,
      isArchived: task.isArchived,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  };
}
