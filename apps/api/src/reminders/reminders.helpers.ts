import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  CalendarEvent,
  HouseholdTask,
  HouseholdTaskInstance,
  MealType,
  Member,
  Menu,
  MaintenancePlan,
  Poll,
  Reminder,
  ReminderSourceModule,
  TravelPlan,
} from '../entities';
import { isHouseholdManager, taskOccursOn } from '@family/shared';

export interface ReminderSource {
  module: ReminderSourceModule;
  sourceId: string;
  occurrenceDate: string | null;
  title: string;
  summary: string | null;
  date: string | null;
  startsAt: string | null;
  targetPath: string;
  status: string;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

function normalizedDate(value: string | Date) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

export function parseRemindAt(value: string) {
  const remindAt = new Date(value);
  if (!Number.isFinite(remindAt.getTime())) {
    throw new BadRequestException('提醒时间无效');
  }
  if (remindAt.getTime() <= Date.now()) {
    throw new BadRequestException('提醒时间必须晚于当前时间');
  }
  return remindAt;
}

export function assertOccurrenceDate(module: ReminderSourceModule, value?: string | null) {
  if (module === 'task' && !value) {
    throw new BadRequestException('周期任务提醒需要指定发生日期');
  }
  if (module !== 'task' && value) {
    throw new BadRequestException('只有任务提醒可以指定发生日期');
  }
}

export function present(
  reminder: Reminder,
  user: JwtUser,
  source: ReminderSource | null,
) {
  return {
    id: reminder.id,
    sourceModule: reminder.sourceModule,
    sourceId: reminder.sourceId,
    occurrenceDate: reminder.occurrenceDate,
    remindAt: reminder.remindAt.toISOString(),
    status: reminder.status,
    source,
    createdById: reminder.createdById,
    createdBy: reminder.createdBy,
    recipients: [...(reminder.recipients ?? [])]
      .sort((left, right) => left.member.name.localeCompare(right.member.name, 'zh-CN'))
      .map((recipient) => ({
        id: recipient.id,
        member: recipient.member,
        deliveredAt: recipient.deliveredAt?.toISOString() ?? null,
      })),
    sentAt: reminder.sentAt?.toISOString() ?? null,
    cancelledAt: reminder.cancelledAt?.toISOString() ?? null,
    cancelReason: reminder.cancelReason,
    canManage: reminder.createdById === user.memberId || isHouseholdManager(user),
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

export async function resolveSource(
  manager: EntityManager,
  reminder: Pick<
    Reminder,
    'householdId' | 'sourceModule' | 'sourceId' | 'occurrenceDate'
  >,
  actionableOnly: boolean,
): Promise<ReminderSource | null> {
  if (reminder.sourceModule === 'menu') {
    const menu = await manager.getRepository(Menu).findOne({
      where: { id: reminder.sourceId, householdId: reminder.householdId },
      relations: { items: true },
    });
    if (!menu) return null;
    const activeItems = menu.items.filter((item) => item.status !== 'rejected');
    if (actionableOnly && (menu.status !== 'open' || !activeItems.length)) return null;
    return {
      module: 'menu',
      sourceId: menu.id,
      occurrenceDate: null,
      title: `${MEAL_LABELS[menu.mealType]}菜单`,
      summary: activeItems.length
        ? activeItems.map((item) => item.dish.name).slice(0, 5).join('、')
        : null,
      date: normalizedDate(menu.date),
      startsAt: null,
      targetPath: `/kitchen?date=${normalizedDate(menu.date)}&mealType=${menu.mealType}`,
      status: menu.status,
    };
  }

  if (reminder.sourceModule === 'calendar') {
    const event = await manager.getRepository(CalendarEvent).findOneBy({
      id: reminder.sourceId,
      householdId: reminder.householdId,
    });
    if (!event) return null;
    return {
      module: 'calendar',
      sourceId: event.id,
      occurrenceDate: null,
      title: event.title,
      summary: event.note,
      date: normalizedDate(event.date),
      startsAt: event.startsAt?.toISOString() ?? null,
      targetPath: `/calendar?date=${normalizedDate(event.date)}&eventId=${event.id}`,
      status: 'scheduled',
    };
  }

  if (reminder.sourceModule === 'task') {
    if (!reminder.occurrenceDate) return null;
    const task = await manager.getRepository(HouseholdTask).findOneBy({
      id: reminder.sourceId,
      householdId: reminder.householdId,
    });
    if (!task || !taskOccursOn(task, reminder.occurrenceDate)) return null;
    const instance = await manager.getRepository(HouseholdTaskInstance).findOneBy({
      householdId: reminder.householdId,
      taskId: task.id,
      dueDate: reminder.occurrenceDate,
    });
    const status = instance?.status ?? 'pending';
    if (actionableOnly && (task.isArchived || status !== 'pending')) return null;
    return {
      module: 'task',
      sourceId: task.id,
      occurrenceDate: reminder.occurrenceDate,
      title: task.title,
      summary: task.note,
      date: reminder.occurrenceDate,
      startsAt: null,
      targetPath: `/tasks?date=${reminder.occurrenceDate}&taskId=${task.id}`,
      status,
    };
  }

  if (reminder.sourceModule === 'maintenance') {
    const plan = await manager.getRepository(MaintenancePlan).findOneBy({
      id: reminder.sourceId,
      householdId: reminder.householdId,
    });
    if (!plan) return null;
    const active = plan.isEnabled && plan.asset.status === 'active';
    if (actionableOnly && !active) return null;
    return {
      module: 'maintenance',
      sourceId: plan.id,
      occurrenceDate: null,
      title: `${plan.asset.name} · ${plan.title}`,
      summary: plan.note,
      date: plan.nextDueDate,
      startsAt: null,
      targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
      status: active ? 'scheduled' : 'cancelled',
    };
  }

  if (reminder.sourceModule === 'travel') {
    const plan = await manager.getRepository(TravelPlan).findOne({
      where: { id: reminder.sourceId, householdId: reminder.householdId },
      relations: { items: true },
    });
    if (!plan || plan.archivedAt) return null;
    const activeItems = plan.items.filter((item) => !item.archivedAt);
    const completed = activeItems.filter(
      (item) => item.status === 'completed',
    ).length;
    const active = plan.status === 'planned';
    if (actionableOnly && !active) return null;
    return {
      module: 'travel',
      sourceId: plan.id,
      occurrenceDate: null,
      title: plan.title,
      summary: [
        plan.destination,
        `${completed}/${activeItems.length} 项完成`,
      ]
        .filter(Boolean)
        .join(' · '),
      date: plan.startDate,
      startsAt: null,
      targetPath: `/travel?planId=${plan.id}`,
      status: plan.status,
    };
  }

  const poll = await manager.getRepository(Poll).findOneBy({
    id: reminder.sourceId,
    householdId: reminder.householdId,
  });
  if (!poll) return null;
  const open =
    !poll.isArchived &&
    poll.status === 'open' &&
    (!poll.closesAt || poll.closesAt.getTime() > Date.now());
  if (actionableOnly && !open) return null;
  return {
    module: 'poll',
    sourceId: poll.id,
    occurrenceDate: null,
    title: poll.title,
    summary: poll.description,
    date: poll.closesAt?.toISOString().slice(0, 10) ?? null,
    startsAt: poll.closesAt?.toISOString() ?? null,
    targetPath: `/polls?pollId=${poll.id}`,
    status: open ? 'open' : 'closed',
  };
}

export async function requireMembers(
  memberIds: string[],
  user: JwtUser,
  manager: EntityManager,
) {
  const members = await manager.getRepository(Member).findBy({
    id: In(memberIds),
    householdId: user.householdId,
  });
  if (members.length !== memberIds.length) {
    throw new NotFoundException('提醒接收人不属于当前家庭');
  }
  return members;
}

export async function lockReminder(id: string, user: JwtUser, manager: EntityManager) {
  const reminder = await manager
    .getRepository(Reminder)
    .createQueryBuilder('reminder')
    .where('reminder.id = :id', { id })
    .andWhere('reminder.householdId = :householdId', {
      householdId: user.householdId,
    })
    .setLock('pessimistic_write')
    .getOne();
  if (!reminder) throw new NotFoundException('提醒不存在');
  return reminder;
}

export function assertManageable(reminder: Reminder, user: JwtUser) {
  if (reminder.createdById !== user.memberId && !isHouseholdManager(user)) {
    throw new ForbiddenException('只能管理自己创建的提醒');
  }
}
