import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  Member,
  Reminder,
  TravelChecklistCategory,
  TravelChecklistItem,
  TravelChecklistStatus,
  TravelOperation,
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelPlan,
  TravelPlanStatus,
  TravelTemplateApplication,
} from '../entities';
import { isHouseholdManager, normalizedRequiredText, normalizedText } from '@family/shared';

const TRAVEL_CATEGORIES: TravelChecklistCategory[] = [
  'documents',
  'clothing',
  'toiletries',
  'electronics',
  'supplies',
  'other',
];

class TravelListQueryDto {
  @IsOptional()
  @IsIn(['active', 'completed', 'cancelled', 'archived', 'all'])
  status?: 'active' | 'completed' | 'cancelled' | 'archived' | 'all';
}

class TravelTemplateListQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';
}

class CreateTravelPlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpdateTravelPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class TravelVersionOperationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class CreateTravelItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsIn(TRAVEL_CATEGORIES)
  category: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsUUID()
  assignedMemberId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpdateTravelItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(TRAVEL_CATEGORIES)
  category?: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsUUID()
  assignedMemberId?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class TravelItemVersionOperationDto extends TravelVersionOperationDto {}

class TravelTemplateItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsIn(TRAVEL_CATEGORIES)
  category: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
}

class CreateTravelTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TravelTemplateItemDto)
  items: TravelTemplateItemDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpdateTravelTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TravelTemplateItemDto)
  items?: TravelTemplateItemDto[];

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class ApplyTravelTemplateDto {
  @IsInt()
  @Min(1)
  expectedPlanVersion: number;

  @IsInt()
  @Min(1)
  expectedTemplateVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

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

function assertDateRange(startDate: string, endDate: string) {
  if (parseDateOnly(startDate, '出发日期') > parseDateOnly(endDate, '返程日期')) {
    throw new BadRequestException('返程日期不能早于出发日期');
  }
  const days = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000;
  if (days > 730) throw new BadRequestException('单个出行计划最长为 731 天');
}

function fingerprint(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedTemplateItems(items: TravelTemplateItemDto[]) {
  return items.map((item, index) => ({
    title: normalizedRequiredText(item.title, `第 ${index + 1} 项`),
    category: item.category,
    quantity: item.quantity ?? 1,
    sortOrder: index,
  }));
}

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
    return plans.map((plan) => this.planResponse(plan, user));
  }

  async detail(id: string, user: JwtUser) {
    const plan = await this.requirePlan(id, user.householdId);
    const applications = await this.dataSource
      .getRepository(TravelTemplateApplication)
      .findBy({ householdId: user.householdId, planId: id });
    return this.planResponse(
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
        await this.saveOperation(manager, user, {
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
        this.assertPlanActionable(plan);
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
        this.assertPlanActionable(plan);
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
        await this.cancelScheduledReminders(manager, plan.id, 'travel_completed');
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
        this.assertPlanActionable(plan);
        plan.status = 'cancelled';
        await this.cancelScheduledReminders(manager, plan.id, 'travel_cancelled');
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
        await this.cancelScheduledReminders(manager, plan.id, 'travel_archived');
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
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);

    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await this.lockPlan(planId, user, manager);
        this.assertPlanActionable(plan);
        await this.requireAssignedMember(payload.assignedMemberId, user, manager);
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
        await this.saveOperation(manager, user, {
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
      return this.detail(resultPlanId, user);
    } catch (error) {
      return this.resolveRace(error, key, requestFingerprint, user);
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
        await this.requireAssignedMember(
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
        this.assertCanManagePlan(plan, user);
        if (item.archivedAt) throw new ConflictException('清单项已经移除');
        item.archivedAt = new Date();
      },
    );
  }

  async listTemplates(query: TravelTemplateListQueryDto, user: JwtUser) {
    const status = query.status ?? 'active';
    const builder = this.templates
      .createQueryBuilder('template')
      .leftJoinAndSelect('template.createdBy', 'createdBy')
      .leftJoinAndSelect('template.updatedBy', 'updatedBy')
      .leftJoinAndSelect('template.items', 'item')
      .where('template.householdId = :householdId', {
        householdId: user.householdId,
      });
    if (status === 'active') builder.andWhere('template.archivedAt IS NULL');
    if (status === 'archived') builder.andWhere('template.archivedAt IS NOT NULL');
    const templates = await builder
      .orderBy('template.updatedAt', 'DESC')
      .addOrderBy('item.sortOrder', 'ASC')
      .getMany();
    return templates.map((template) => this.templateResponse(template, user));
  }

  async createTemplate(dto: CreateTravelTemplateDto, user: JwtUser) {
    const payload = {
      title: normalizedRequiredText(dto.title, '模板名称'),
      description: normalizedText(dto.description),
      items: normalizedTemplateItems(dto.items),
    };
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({ operation: 'template_create', ...payload });
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);

    try {
      const templateId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.targetId;
        const repository = manager.getRepository(TravelPackingTemplate);
        const template = await repository.save(
          repository.create({
            householdId: user.householdId,
            title: payload.title,
            description: payload.description,
            version: 1,
            createdById: user.memberId,
            updatedById: user.memberId,
            archivedAt: null,
          }),
        );
        await manager.getRepository(TravelPackingTemplateItem).save(
          payload.items.map((item) => ({
            ...item,
            householdId: user.householdId,
            templateId: template.id,
          })),
        );
        await this.saveOperation(manager, user, {
          operation: 'template_create',
          targetType: 'template',
          targetId: template.id,
          planId: null,
          key,
          requestFingerprint,
          metadata: { version: 1, itemCount: payload.items.length },
        });
        await recordActivity(manager, user, {
          module: 'travel',
          action: 'travel_template_created',
          summary: `${user.name}创建了出行模板「${template.title}」`,
          targetPath: '/travel?view=templates',
          metadata: { templateId: template.id, itemCount: payload.items.length },
        });
        return template.id;
      });
      return this.templateDetail(templateId, user);
    } catch (error) {
      return this.resolveRace(error, key, requestFingerprint, user);
    }
  }

  async updateTemplate(
    id: string,
    dto: UpdateTravelTemplateDto,
    user: JwtUser,
  ) {
    const fields = {
      ...(dto.title !== undefined
        ? { title: normalizedRequiredText(dto.title, '模板名称') }
        : {}),
      ...(dto.description !== undefined
        ? { description: normalizedText(dto.description) }
        : {}),
      ...(dto.items !== undefined
        ? { items: normalizedTemplateItems(dto.items) }
        : {}),
    };
    if (!Object.keys(fields).length) {
      throw new BadRequestException('至少提供一个需要更新的字段');
    }
    return this.mutateTemplate(
      id,
      dto,
      'template_update',
      { operation: 'template_update', templateId: id, ...fields },
      user,
      async (template, manager) => {
        if (template.archivedAt) throw new ConflictException('已归档模板需要先恢复');
        if (fields.title !== undefined) template.title = fields.title;
        if (fields.description !== undefined) template.description = fields.description;
        if (fields.items) {
          await manager.getRepository(TravelPackingTemplateItem).delete({
            householdId: user.householdId,
            templateId: template.id,
          });
          await manager.getRepository(TravelPackingTemplateItem).save(
            fields.items.map((item) => ({
              ...item,
              householdId: user.householdId,
              templateId: template.id,
            })),
          );
        }
      },
    );
  }

  archiveTemplate(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutateTemplate(
      id,
      dto,
      'template_archive',
      { operation: 'template_archive', templateId: id },
      user,
      (template) => {
        if (template.archivedAt) throw new ConflictException('模板已经归档');
        template.archivedAt = new Date();
      },
    );
  }

  restoreTemplate(id: string, dto: TravelVersionOperationDto, user: JwtUser) {
    return this.mutateTemplate(
      id,
      dto,
      'template_restore',
      { operation: 'template_restore', templateId: id },
      user,
      (template) => {
        if (!template.archivedAt) throw new ConflictException('模板当前未归档');
        template.archivedAt = null;
      },
    );
  }

  async applyTemplate(
    planId: string,
    templateId: string,
    dto: ApplyTravelTemplateDto,
    user: JwtUser,
  ) {
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({
      operation: 'template_apply',
      planId,
      templateId,
      expectedPlanVersion: dto.expectedPlanVersion,
      expectedTemplateVersion: dto.expectedTemplateVersion,
    });
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);

    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await this.lockPlan(planId, user, manager);
        this.assertCanManagePlan(plan, user);
        this.assertPlanActionable(plan);
        if (plan.version !== dto.expectedPlanVersion) {
          throw new ConflictException(`行程已更新，请刷新后重试（当前 v${plan.version}）`);
        }
        const template = await manager
          .getRepository(TravelPackingTemplate)
          .createQueryBuilder('template')
          .leftJoinAndSelect('template.items', 'item')
          .where('template.id = :templateId', { templateId })
          .andWhere('template.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write', undefined, ['template'])
          .getOne();
        if (!template) throw new NotFoundException('出行模板不存在');
        if (template.archivedAt) throw new ConflictException('已归档模板不能应用');
        if (template.version !== dto.expectedTemplateVersion) {
          throw new ConflictException(
            `模板已更新，请刷新后重试（当前 v${template.version}）`,
          );
        }
        const prior = await manager.getRepository(TravelTemplateApplication).findOneBy({
          householdId: user.householdId,
          planId,
          templateId,
        });
        if (prior) throw new ConflictException('这个模板已经应用到当前行程');

        const applicationRepository = manager.getRepository(TravelTemplateApplication);
        const application = await applicationRepository.save(
          applicationRepository.create({
            householdId: user.householdId,
            planId,
            templateId,
            templateVersion: template.version,
            appliedById: user.memberId,
          }),
        );
        const rawMax = await manager
          .getRepository(TravelChecklistItem)
          .createQueryBuilder('item')
          .select('COALESCE(MAX(item.sortOrder), -1)', 'max')
          .where('item.planId = :planId', { planId })
          .andWhere('item.householdId = :householdId', {
            householdId: user.householdId,
          })
          .getRawOne<{ max: string }>();
        const startOrder = Number(rawMax?.max ?? -1) + 1;
        const sortedItems = [...template.items].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        );
        await manager.getRepository(TravelChecklistItem).save(
          sortedItems.map((item, index) => ({
            householdId: user.householdId,
            planId,
            title: item.title,
            category: item.category,
            quantity: item.quantity,
            note: null,
            sortOrder: startOrder + index,
            status: 'pending' as TravelChecklistStatus,
            version: 1,
            assignedMemberId: null,
            completedById: null,
            completedAt: null,
            createdById: user.memberId,
            updatedById: user.memberId,
            templateApplicationId: application.id,
            sourceTemplateItemId: item.id,
            archivedAt: null,
          })),
        );
        plan.version += 1;
        plan.updatedById = user.memberId;
        await manager.getRepository(TravelPlan).save(plan);
        await this.saveOperation(manager, user, {
          operation: 'template_apply',
          targetType: 'application',
          targetId: application.id,
          planId,
          key,
          requestFingerprint,
          metadata: {
            planVersion: plan.version,
            templateId,
            templateVersion: template.version,
            itemCount: sortedItems.length,
          },
        });
        await recordActivity(manager, user, {
          module: 'travel',
          action: 'travel_template_applied',
          summary: `${user.name}将模板「${template.title}」应用到「${plan.title}」`,
          targetPath: `/travel?planId=${plan.id}`,
          metadata: { planId, templateId, itemCount: sortedItems.length },
        });
        return plan.id;
      });
      return this.detail(resultPlanId, user);
    } catch (error) {
      const constraint = (error as { driverError?: { constraint?: string } })
        ?.driverError?.constraint;
      if (constraint === 'UQ_travel_template_applications_plan_template') {
        throw new ConflictException('这个模板已经应用到当前行程');
      }
      return this.resolveRace(error, key, requestFingerprint, user);
    }
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
        const plan = await this.lockPlan(id, user, manager);
        this.assertCanManagePlan(plan, user);
        if (plan.version !== dto.expectedVersion) {
          throw new ConflictException(`行程已更新，请刷新后重试（当前 v${plan.version}）`);
        }
        await apply(plan, manager);
        plan.version += 1;
        plan.updatedById = user.memberId;
        await manager.getRepository(TravelPlan).save(plan);
        await this.saveOperation(manager, user, {
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
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);
    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await this.lockPlan(planId, user, manager);
        this.assertPlanActionable(plan);
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
        await this.saveOperation(manager, user, {
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
      return this.detail(resultPlanId, user);
    } catch (error) {
      return this.resolveRace(error, key, requestFingerprint, user);
    }
  }

  private async mutateTemplate(
    id: string,
    dto: TravelVersionOperationDto,
    operation: string,
    fingerprintPayload: Record<string, unknown>,
    user: JwtUser,
    apply: (
      template: TravelPackingTemplate,
      manager: EntityManager,
    ) => void | Promise<void>,
  ) {
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({
      ...fingerprintPayload,
      expectedVersion: dto.expectedVersion,
    });
    const existing = await this.findOperation(key, requestFingerprint, user);
    if (existing) return this.operationResult(existing, user);
    try {
      const templateId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.targetId;
        const template = await manager
          .getRepository(TravelPackingTemplate)
          .createQueryBuilder('template')
          .where('template.id = :id', { id })
          .andWhere('template.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!template) throw new NotFoundException('出行模板不存在');
        this.assertCanManageTemplate(template, user);
        if (template.version !== dto.expectedVersion) {
          throw new ConflictException(
            `模板已更新，请刷新后重试（当前 v${template.version}）`,
          );
        }
        await apply(template, manager);
        template.version += 1;
        template.updatedById = user.memberId;
        await manager.getRepository(TravelPackingTemplate).save(template);
        await this.saveOperation(manager, user, {
          operation,
          targetType: 'template',
          targetId: template.id,
          planId: null,
          key,
          requestFingerprint,
          metadata: { version: template.version },
        });
        return template.id;
      });
      return this.templateDetail(templateId, user);
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

  private async templateDetail(id: string, user: JwtUser) {
    const template = await this.templates.findOne({
      where: { id, householdId: user.householdId },
      relations: { items: true },
    });
    if (!template) throw new NotFoundException('出行模板不存在');
    return this.templateResponse(template, user);
  }

  private lockPlan(id: string, user: JwtUser, manager: EntityManager) {
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

  private assertCanManagePlan(plan: TravelPlan, user: JwtUser) {
    if (!isHouseholdManager(user) && plan.createdById !== user.memberId) {
      throw new ForbiddenException('只能维护自己创建的出行计划');
    }
  }

  private assertCanManageTemplate(template: TravelPackingTemplate, user: JwtUser) {
    if (!isHouseholdManager(user) && template.createdById !== user.memberId) {
      throw new ForbiddenException('只能维护自己创建的出行模板');
    }
  }

  private assertPlanActionable(plan: TravelPlan) {
    if (plan.archivedAt) throw new ConflictException('已归档行程需要先恢复');
    if (plan.status !== 'planned') {
      throw new ConflictException('只有计划中的行程可以修改清单');
    }
  }

  private async requireAssignedMember(
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

  private cancelScheduledReminders(
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

  private async findOperation(
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

  private saveOperation(
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

  private operationResult(operation: TravelOperation, user: JwtUser) {
    return operation.targetType === 'template'
      ? this.templateDetail(operation.targetId, user)
      : this.detail(operation.planId ?? operation.targetId, user);
  }

  private async resolveRace(
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

  private planResponse(
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

  private templateResponse(template: TravelPackingTemplate, user: JwtUser) {
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
}

@Controller()
export class TravelController {
  constructor(private readonly service: TravelService) {}

  @Get('travel-plans')
  listPlans(@Query() query: TravelListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.listPlans(query, user);
  }

  @Get('travel-plans/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('travel-plans')
  createPlan(@Body() dto: CreateTravelPlanDto, @CurrentUser() user: JwtUser) {
    return this.service.createPlan(dto, user);
  }

  @Patch('travel-plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateTravelPlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePlan(id, dto, user);
  }

  @Post('travel-plans/:id/complete')
  completePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.completePlan(id, dto, user);
  }

  @Post('travel-plans/:id/reopen')
  reopenPlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reopenPlan(id, dto, user);
  }

  @Post('travel-plans/:id/cancel')
  cancelPlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.cancelPlan(id, dto, user);
  }

  @Post('travel-plans/:id/archive')
  archivePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archivePlan(id, dto, user);
  }

  @Post('travel-plans/:id/restore')
  restorePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restorePlan(id, dto, user);
  }

  @Post('travel-plans/:planId/items')
  createItem(
    @Param('planId') planId: string,
    @Body() dto: CreateTravelItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createItem(planId, dto, user);
  }

  @Patch('travel-plans/:planId/items/:itemId')
  updateItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTravelItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/complete')
  completeItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.completeItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/restore')
  restoreItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/skip')
  skipItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.skipItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/archive')
  archiveItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archiveItem(planId, itemId, dto, user);
  }

  @Get('travel-templates')
  listTemplates(
    @Query() query: TravelTemplateListQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listTemplates(query, user);
  }

  @Post('travel-templates')
  createTemplate(
    @Body() dto: CreateTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createTemplate(dto, user);
  }

  @Patch('travel-templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateTemplate(id, dto, user);
  }

  @Post('travel-templates/:id/archive')
  archiveTemplate(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archiveTemplate(id, dto, user);
  }

  @Post('travel-templates/:id/restore')
  restoreTemplate(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreTemplate(id, dto, user);
  }

  @Post('travel-plans/:planId/templates/:templateId/apply')
  applyTemplate(
    @Param('planId') planId: string,
    @Param('templateId') templateId: string,
    @Body() dto: ApplyTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.applyTemplate(planId, templateId, dto, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TravelPlan,
      TravelChecklistItem,
      TravelPackingTemplate,
      TravelPackingTemplateItem,
      TravelTemplateApplication,
      TravelOperation,
      Reminder,
      Member,
    ]),
  ],
  controllers: [TravelController],
  providers: [TravelService],
  exports: [TravelService],
})
export class TravelModule {}
