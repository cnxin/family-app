import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { Member, Reminder, TravelOperation, TravelPackingTemplate, TravelPlan } from '../entities';
import { isHouseholdManager, normalizedRequiredText } from '@family/shared';
import { TravelTemplateItemDto } from './travel.dto';

function parseDateOnly(value: string, label: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label}不是有效日期`);
  }
  return timestamp;
}

export function assertDateRange(startDate: string, endDate: string) {
  if (parseDateOnly(startDate, '出发日期') > parseDateOnly(endDate, '返程日期')) {
    throw new BadRequestException('返程日期不能早于出发日期');
  }
  const days = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000;
  if (days > 730) throw new BadRequestException('单个出行计划最长为 731 天');
}

export function normalizedTemplateItems(items: TravelTemplateItemDto[]) {
  return items.map((item, index) => ({
    title: normalizedRequiredText(item.title, `第 ${index + 1} 项`),
    category: item.category,
    quantity: item.quantity ?? 1,
    sortOrder: index,
  }));
}

export function lockPlan(id: string, user: JwtUser, manager: EntityManager) {
  return manager
    .getRepository(TravelPlan)
    .createQueryBuilder('plan')
    .where('plan.id = :id', { id })
    .andWhere('plan.householdId = :householdId', {
      householdId: user.householdId,
    })
    .setLock('pessimistic_write')
    .getOne()
    .then((plan) => {
      if (!plan) throw new NotFoundException('出行计划不存在');
      return plan;
    });
}

export function assertCanManagePlan(plan: TravelPlan, user: JwtUser) {
  if (!isHouseholdManager(user) && plan.createdById !== user.memberId) {
    throw new ForbiddenException('只能维护自己创建的出行计划');
  }
}

export function assertCanManageTemplate(template: TravelPackingTemplate, user: JwtUser) {
  if (!isHouseholdManager(user) && template.createdById !== user.memberId) {
    throw new ForbiddenException('只能维护自己创建的出行模板');
  }
}

export function assertPlanActionable(plan: TravelPlan) {
  if (plan.archivedAt) throw new ConflictException('已归档行程需要先恢复');
  if (plan.status !== 'planned') {
    throw new ConflictException('只有计划中的行程可以修改清单');
  }
}

export async function requireAssignedMember(
  memberId: string | null,
  user: JwtUser,
  manager: EntityManager,
) {
  if (!memberId) return;
  const member = await manager.getRepository(Member).findOneBy({
    id: memberId,
    householdId: user.householdId,
  });
  if (!member || member.disabledAt) {
    throw new NotFoundException('清单负责人不属于当前家庭或已停用');
  }
}

export function cancelScheduledReminders(
  manager: EntityManager,
  planId: string,
  reason: string,
) {
  return manager.getRepository(Reminder).update(
    {
      sourceModule: 'travel',
      sourceId: planId,
      status: 'scheduled',
    },
    {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  );
}

export function saveOperation(
  manager: EntityManager,
  user: JwtUser,
  input: {
    operation: string;
    targetType: TravelOperation['targetType'];
    targetId: string;
    planId: string | null;
    key: string;
    requestFingerprint: string;
    metadata: Record<string, unknown>;
  },
) {
  const repository = manager.getRepository(TravelOperation);
  return repository.save(
    repository.create({
      householdId: user.householdId,
      operation: input.operation,
      targetType: input.targetType,
      targetId: input.targetId,
      planId: input.planId,
      actorId: user.memberId,
      actorName: user.name,
      idempotencyKey: input.key,
      requestFingerprint: input.requestFingerprint,
      metadata: input.metadata,
    }),
  );
}

export function planResponse(
  plan: TravelPlan,
  user: JwtUser,
  appliedTemplateIds: string[] = [],
) {
  const items = [...(plan.items ?? [])]
    .filter((item) => !item.archivedAt)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      quantity: item.quantity,
      note: item.note,
      sortOrder: item.sortOrder,
      status: item.status,
      version: item.version,
      assignedMember: item.assignedMember
        ? {
            id: item.assignedMember.id,
            name: item.assignedMember.name,
            avatarEmoji: item.assignedMember.avatarEmoji,
          }
        : null,
      completedBy: item.completedBy
        ? {
            id: item.completedBy.id,
            name: item.completedBy.name,
            avatarEmoji: item.completedBy.avatarEmoji,
          }
        : null,
      completedAt: item.completedAt,
      fromTemplate: Boolean(item.templateApplicationId),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  return {
    id: plan.id,
    title: plan.title,
    destination: plan.destination,
    startDate: plan.startDate,
    endDate: plan.endDate,
    note: plan.note,
    status: plan.status,
    version: plan.version,
    createdBy: {
      id: plan.createdBy.id,
      name: plan.createdBy.name,
      avatarEmoji: plan.createdBy.avatarEmoji,
    },
    updatedBy: {
      id: plan.updatedBy.id,
      name: plan.updatedBy.name,
      avatarEmoji: plan.updatedBy.avatarEmoji,
    },
    completedBy: plan.completedBy
      ? {
          id: plan.completedBy.id,
          name: plan.completedBy.name,
          avatarEmoji: plan.completedBy.avatarEmoji,
        }
      : null,
    completedAt: plan.completedAt,
    archivedAt: plan.archivedAt,
    items,
    counts: {
      total: items.length,
      pending: items.filter((item) => item.status === 'pending').length,
      completed: items.filter((item) => item.status === 'completed').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
    },
    appliedTemplateIds,
    canManage: isHouseholdManager(user) || plan.createdById === user.memberId,
    canEditChecklist: plan.status === 'planned' && !plan.archivedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function templateResponse(template: TravelPackingTemplate, user: JwtUser) {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    version: template.version,
    items: [...(template.items ?? [])]
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        quantity: item.quantity,
        sortOrder: item.sortOrder,
      })),
    createdBy: {
      id: template.createdBy.id,
      name: template.createdBy.name,
      avatarEmoji: template.createdBy.avatarEmoji,
    },
    archivedAt: template.archivedAt,
    canManage: isHouseholdManager(user) || template.createdById === user.memberId,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}
