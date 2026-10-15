import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  TravelChecklistItem,
  TravelOperation,
  TravelPackingTemplate,
  TravelPlan,
  TravelTemplateApplication,
} from '../entities';
import { rawFingerprint as fingerprint } from '../common/fingerprint';
import { normalizedRequiredText, normalizedText } from '@family/shared';
import {
  TravelListQueryDto,
  CreateTravelPlanDto,
  UpdateTravelPlanDto,
  TravelVersionOperationDto,
} from './travel.dto';
import {
  assertDateRange,
  lockPlan,
  assertCanManagePlan,
  assertPlanActionable,
  cancelScheduledReminders,
  saveOperation,
  planResponse,
  templateResponse,
} from './travel.helpers';

@Injectable()
export class TravelService {
  constructor(
    @InjectRepository(TravelPlan)
    private readonly plans: Repository<TravelPlan>,
    @InjectRepository(TravelPackingTemplate)
    private readonly templates: Repository<TravelPackingTemplate>,
    @InjectRepository(TravelOperation)
    private readonly operations: Repository<TravelOperation>,
    private readonly dataSource: DataSource,
  ) {}

  async listPlans(query: TravelListQueryDto, user: JwtUser) {
    const status = query.status ?? 'active';
    const builder = this.plans
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.createdBy', 'createdBy')
      .leftJoinAndSelect('plan.updatedBy', 'updatedBy')
      .leftJoinAndSelect('plan.completedBy', 'completedBy')
      .leftJoinAndSelect('plan.items', 'item')
      .leftJoinAndSelect('item.assignedMember', 'assignedMember')
      .leftJoinAndSelect('item.completedBy', 'itemCompletedBy')
      .where('plan.householdId = :householdId', {
        householdId: user.householdId,
      });
    if (status === 'active') {
      builder.andWhere('plan.archivedAt IS NULL').andWhere('plan.status = :status', {
        status: 'planned',
      });
    } else if (status === 'archived') {
      builder.andWhere('plan.archivedAt IS NOT NULL');
    } else if (status !== 'all') {
      builder.andWhere('plan.archivedAt IS NULL').andWhere('plan.status = :status', {
        status,
      });
    }
    const plans = await builder
      .orderBy('plan.startDate', status === 'active' ? 'ASC' : 'DESC')
      .addOrderBy('plan.createdAt', 'DESC')
      .getMany();
    return plans.map((plan) => planResponse(plan, user));
  }

  async detail(id: string, user: JwtUser) {
    const plan = await this.requirePlan(id, user.householdId);
    const applications = await this.dataSource
      .getRepository(TravelTemplateApplication)
      .findBy({ householdId: user.householdId, planId: id });
    return planResponse(
      plan,
      user,
      applications.map((application) => application.templateId),
    );
  }

  async createPlan(dto: CreateTravelPlanDto, user: JwtUser) {
    const payload = {
      title: normalizedRequiredText(dto.title, '行程名称'),
      destination: normalizedText(dto.destination),
      startDate: dto.startDate,
      endDate: dto.endDate,
      note: normalizedText(dto.note),
    };
    assertDateRange(payload.startDate, payload.endDate);
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({ operation: 'plan_create', ...payload });
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);

    try {
      const planId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.targetId;
        const repository = manager.getRepository(TravelPlan);
        const plan = await repository.save(
          repository.create({
            householdId: user.householdId,
            ...payload,
            status: 'planned',
            version: 1,
            createdById: user.memberId,
            updatedById: user.memberId,
            completedById: null,
            completedAt: null,
            archivedAt: null,
          }),
        );
        await saveOperation(manager, user, {
          operation: 'plan_create',
          targetType: 'plan',
          targetId: plan.id,
          planId: plan.id,
          key,
          requestFingerprint,
          metadata: { version: plan.version },
        });
        await recordActivity(manager, user, {
          module: 'travel',
          action: 'travel_plan_created',
          summary: `${user.name}创建了出行计划「${plan.title}」`,
          targetPath: `/travel?planId=${plan.id}`,
          metadata: { planId: plan.id, startDate: plan.startDate, endDate: plan.endDate },
        });
        return plan.id;
      });
      return this.detail(planId, user);
    } catch (error) {
      return this.resolveRace(error, key, requestFingerprint, user);
    }
  }

  updatePlan(id: string, dto: UpdateTravelPlanDto, user: JwtUser) {
    const fields = {
      ...(dto.title !== undefined
        ? { title: normalizedRequiredText(dto.title, '行程名称') }
        : {}),
      ...(dto.destination !== undefined
        ? { destination: normalizedText(dto.destination) }
        : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.note !== undefined ? { note: normalizedText(dto.note) } : {}),
    };
    if (!Object.keys(fields).length) {
      throw new BadRequestException('至少提供一个需要更新的字段');
    }
    return this.mutatePlan(
      id,
      dto,
      'plan_update',
      { operation: 'plan_update', planId: id, ...fields },
      user,
      (plan) => {
        assertPlanActionable(plan);
        const startDate = fields.startDate ?? plan.startDate;
        const endDate = fields.endDate ?? plan.endDate;
        assertDateRange(startDate, endDate);
        Object.assign(plan, fields);
      },
      '更新',
    );
  }

  completePlan(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutatePlan(
      id,
      dto,
      'plan_complete',
      { operation: 'plan_complete', planId: id },
      user,
      async (plan, manager) => {
        assertPlanActionable(plan);
        const pending = await manager.getRepository(TravelChecklistItem).count({
          where: {
            householdId: user.householdId,
            planId: plan.id,
            status: 'pending',
            archivedAt: IsNull(),
          },
        });
        if (pending) {
          throw new ConflictException(`仍有 ${pending} 项待处理，请先完成或跳过`);
        }
        plan.status = 'completed';
        plan.completedById = user.memberId;
        plan.completedAt = new Date();
        await cancelScheduledReminders(manager, plan.id, 'travel_completed');
      },
      '完成',
    );
  }

  reopenPlan(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutatePlan(
      id,
      dto,
      'plan_reopen',
      { operation: 'plan_reopen', planId: id },
      user,
      (plan) => {
        if (plan.archivedAt) throw new ConflictException('已归档行程需要先恢复');
        if (plan.status === 'planned') throw new ConflictException('行程已经处于计划中');
        plan.status = 'planned';
        plan.completedById = null;
        plan.completedAt = null;
      },
      '重新打开',
    );
  }

  cancelPlan(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutatePlan(
      id,
      dto,
      'plan_cancel',
      { operation: 'plan_cancel', planId: id },
      user,
      async (plan, manager) => {
        assertPlanActionable(plan);
        plan.status = 'cancelled';
        await cancelScheduledReminders(manager, plan.id, 'travel_cancelled');
      },
      '取消',
    );
  }

  archivePlan(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutatePlan(
      id,
      dto,
      'plan_archive',
      { operation: 'plan_archive', planId: id },
      user,
      async (plan, manager) => {
        if (plan.archivedAt) throw new ConflictException('行程已经归档');
        plan.archivedAt = new Date();
        await cancelScheduledReminders(manager, plan.id, 'travel_archived');
      },
      '归档',
    );
  }

  restorePlan(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutatePlan(
      id,
      dto,
      'plan_restore',
      { operation: 'plan_restore', planId: id },
      user,
      (plan) => {
        if (!plan.archivedAt) throw new ConflictException('行程当前未归档');
        plan.archivedAt = null;
      },
      '恢复',
    );
  }

  private async mutatePlan(
    id: string,
    dto: TravelVersionOperationDto,
    operation: string,
    fingerprintPayload: Record<string, unknown>,
    user: JwtUser,
    apply: (plan: TravelPlan, manager: EntityManager) => void | Promise<void>,
    actionLabel: string,
  ) {
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({
      ...fingerprintPayload,
      expectedVersion: dto.expectedVersion,
    });
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);
    try {
      const planId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.targetId;
        const plan = await lockPlan(id, user, manager);
        assertCanManagePlan(plan, user);
        if (plan.version !== dto.expectedVersion) {
          throw new ConflictException(`行程已更新，请刷新后重试（当前 v${plan.version}）`);
        }
        await apply(plan, manager);
        plan.version += 1;
        plan.updatedById = user.memberId;
        await manager.getRepository(TravelPlan).save(plan);
        await saveOperation(manager, user, {
          operation,
          targetType: 'plan',
          targetId: plan.id,
          planId: plan.id,
          key,
          requestFingerprint,
          metadata: { version: plan.version, status: plan.status },
        });
        await recordActivity(manager, user, {
          module: 'travel',
          action: `travel_${operation}`,
          summary: `${user.name}${actionLabel}了出行计划「${plan.title}」`,
          targetPath: `/travel?planId=${plan.id}`,
          metadata: { planId: plan.id, version: plan.version, status: plan.status },
        });
        return plan.id;
      });
      return this.detail(planId, user);
    } catch (error) {
      return this.resolveRace(error, key, requestFingerprint, user);
    }
  }

  private requirePlan(id: string, householdId: string) {
    return this.plans
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.createdBy', 'createdBy')
      .leftJoinAndSelect('plan.updatedBy', 'updatedBy')
      .leftJoinAndSelect('plan.completedBy', 'completedBy')
      .leftJoinAndSelect('plan.items', 'item')
      .leftJoinAndSelect('item.assignedMember', 'assignedMember')
      .leftJoinAndSelect('item.completedBy', 'itemCompletedBy')
      .where('plan.id = :id', { id })
      .andWhere('plan.householdId = :householdId', { householdId })
      .getOne()
      .then((plan) => {
        if (!plan) throw new NotFoundException('出行计划不存在');
        return plan;
      });
  }

  async templateDetail(id: string, user: JwtUser) {
    const template = await this.templates.findOne({
      where: { id, householdId: user.householdId },
      relations: { items: true },
    });
    if (!template) throw new NotFoundException('出行模板不存在');
    return templateResponse(template, user);
  }

  async findOperation(
    key: string,
    requestFingerprint: string,
    user: JwtUser,
    manager?: EntityManager,
  ) {
    const operation = await (manager?.getRepository(TravelOperation) ?? this.operations)
      .findOneBy({ householdId: user.householdId, idempotencyKey: key });
    if (!operation) return null;
    if (operation.requestFingerprint !== requestFingerprint) {
      throw new ConflictException('幂等键已用于不同的出行操作');
    }
    return operation;
  }

  operationResult(operation: TravelOperation, user: JwtUser) {
    return operation.targetType === 'template'
      ? this.templateDetail(operation.targetId, user)
      : this.detail(operation.planId ?? operation.targetId, user);
  }

  async resolveRace(
    error: unknown,
    key: string,
    requestFingerprint: string,
    user: JwtUser,
  ) {
    const code =
      (error as { driverError?: { code?: string } })?.driverError?.code ??
      (error as { code?: string })?.code;
    if (code === '23505') {
      const existing = await this.findOperation(key, requestFingerprint, user);
      if (existing) return this.operationResult(existing, user);
    }
    throw error;
  }
}
