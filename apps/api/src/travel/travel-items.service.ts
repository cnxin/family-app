import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { TravelChecklistItem, TravelPlan } from '../entities';
import { rawFingerprint as fingerprint } from '../common/fingerprint';
import { normalizedRequiredText, normalizedText } from '@family/shared';
import {
  CreateTravelItemDto,
  UpdateTravelItemDto,
  TravelItemVersionOperationDto,
} from './travel.dto';
import {
  lockPlan,
  assertCanManagePlan,
  assertPlanActionable,
  requireAssignedMember,
  saveOperation,
} from './travel.helpers';
import { TravelService } from './travel.service';

/** 出行清单条目：新增、修改、完成、恢复、跳过、归档，带幂等键与操作记录（J7.2 从 TravelService 拆出）。 */
@Injectable()
export class TravelItemsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly travelService: TravelService,
  ) {}

  async createItem(planId: string, dto: CreateTravelItemDto, user: JwtUser) {
    const payload = {
      title: normalizedRequiredText(dto.title, '清单项'),
      category: dto.category,
      quantity: dto.quantity ?? 1,
      note: normalizedText(dto.note),
      sortOrder: dto.sortOrder ?? 0,
      assignedMemberId: dto.assignedMemberId ?? null,
    };
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({
      operation: 'item_create',
      planId,
      ...payload,
    });
    const existing = await this.travelService.findOperation(key, requestFingerprint, user);
    if (existing) return this.travelService.operationResult(existing, user);

    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.travelService.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await lockPlan(planId, user, manager);
        assertPlanActionable(plan);
        await requireAssignedMember(payload.assignedMemberId, user, manager);
        const repository = manager.getRepository(TravelChecklistItem);
        const item = await repository.save(
          repository.create({
            householdId: user.householdId,
            planId: plan.id,
            ...payload,
            status: 'pending',
            version: 1,
            completedById: null,
            completedAt: null,
            createdById: user.memberId,
            updatedById: user.memberId,
            templateApplicationId: null,
            sourceTemplateItemId: null,
            archivedAt: null,
          }),
        );
        await saveOperation(manager, user, {
          operation: 'item_create',
          targetType: 'item',
          targetId: item.id,
          planId: plan.id,
          key,
          requestFingerprint,
          metadata: { version: item.version },
        });
        return plan.id;
      });
      return this.travelService.detail(resultPlanId, user);
    } catch (error) {
      return this.travelService.resolveRace(error, key, requestFingerprint, user);
    }
  }

  async updateItem(
    planId: string,
    itemId: string,
    dto: UpdateTravelItemDto,
    user: JwtUser,
  ) {
    const fields = {
      ...(dto.title !== undefined
        ? { title: normalizedRequiredText(dto.title, '清单项') }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
      ...(dto.note !== undefined ? { note: normalizedText(dto.note) } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.assignedMemberId !== undefined
        ? { assignedMemberId: dto.assignedMemberId ?? null }
        : {}),
    };
    if (!Object.keys(fields).length) {
      throw new BadRequestException('至少提供一个需要更新的字段');
    }
    return this.mutateItem(
      planId,
      itemId,
      dto,
      'item_update',
      { operation: 'item_update', planId, itemId, ...fields },
      user,
      async (item, _plan, manager) => {
        await requireAssignedMember(
          fields.assignedMemberId === undefined
            ? item.assignedMemberId
            : fields.assignedMemberId,
          user,
          manager,
        );
        Object.assign(item, fields);
      },
    );
  }

  completeItem(
    planId: string,
    itemId: string,
    dto: TravelItemVersionOperationDto,
    user: JwtUser,
  ) {
    return this.mutateItem(
      planId,
      itemId,
      dto,
      'item_complete',
      { operation: 'item_complete', planId, itemId },
      user,
      (item) => {
        if (item.status === 'completed') throw new ConflictException('清单项已经完成');
        item.status = 'completed';
        item.completedById = user.memberId;
        item.completedAt = new Date();
      },
    );
  }

  restoreItem(
    planId: string,
    itemId: string,
    dto: TravelItemVersionOperationDto,
    user: JwtUser,
  ) {
    return this.mutateItem(
      planId,
      itemId,
      dto,
      'item_restore',
      { operation: 'item_restore', planId, itemId },
      user,
      (item) => {
        if (item.status === 'pending') throw new ConflictException('清单项已经是待处理状态');
        item.status = 'pending';
        item.completedById = null;
        item.completedAt = null;
      },
    );
  }

  skipItem(
    planId: string,
    itemId: string,
    dto: TravelItemVersionOperationDto,
    user: JwtUser,
  ) {
    return this.mutateItem(
      planId,
      itemId,
      dto,
      'item_skip',
      { operation: 'item_skip', planId, itemId },
      user,
      (item) => {
        if (item.status === 'skipped') throw new ConflictException('清单项已经跳过');
        item.status = 'skipped';
        item.completedById = null;
        item.completedAt = null;
      },
    );
  }

  archiveItem(
    planId: string,
    itemId: string,
    dto: TravelItemVersionOperationDto,
    user: JwtUser,
  ) {
    return this.mutateItem(
      planId,
      itemId,
      dto,
      'item_archive',
      { operation: 'item_archive', planId, itemId },
      user,
      (item, plan) => {
        assertCanManagePlan(plan, user);
        if (item.archivedAt) throw new ConflictException('清单项已经移除');
        item.archivedAt = new Date();
      },
    );
  }

  private async mutateItem(
    planId: string,
    itemId: string,
    dto: TravelItemVersionOperationDto,
    operation: string,
    fingerprintPayload: Record<string, unknown>,
    user: JwtUser,
    apply: (
      item: TravelChecklistItem,
      plan: TravelPlan,
      manager: EntityManager,
    ) => void | Promise<void>,
  ) {
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({
      ...fingerprintPayload,
      expectedVersion: dto.expectedVersion,
    });
    const existing = await this.travelService.findOperation(key, requestFingerprint, user);
    if (existing) return this.travelService.operationResult(existing, user);
    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.travelService.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await lockPlan(planId, user, manager);
        assertPlanActionable(plan);
        const item = await manager
          .getRepository(TravelChecklistItem)
          .createQueryBuilder('item')
          .where('item.id = :itemId', { itemId })
          .andWhere('item.planId = :planId', { planId })
          .andWhere('item.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!item) throw new NotFoundException('出行清单项不存在');
        if (item.archivedAt && operation !== 'item_archive') {
          throw new ConflictException('清单项已经移除');
        }
        if (item.version !== dto.expectedVersion) {
          throw new ConflictException(
            `清单项已更新，请刷新后重试（当前 v${item.version}）`,
          );
        }
        await apply(item, plan, manager);
        item.version += 1;
        item.updatedById = user.memberId;
        await manager.getRepository(TravelChecklistItem).save(item);
        await saveOperation(manager, user, {
          operation,
          targetType: 'item',
          targetId: item.id,
          planId,
          key,
          requestFingerprint,
          metadata: { version: item.version, status: item.status },
        });
        return planId;
      });
      return this.travelService.detail(resultPlanId, user);
    } catch (error) {
      return this.travelService.resolveRace(error, key, requestFingerprint, user);
    }
  }
}
