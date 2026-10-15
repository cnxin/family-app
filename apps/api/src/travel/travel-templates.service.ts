import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  TravelChecklistItem,
  TravelChecklistStatus,
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelPlan,
  TravelTemplateApplication,
} from '../entities';
import { rawFingerprint as fingerprint } from '../common/fingerprint';
import { normalizedRequiredText, normalizedText } from '@family/shared';
import {
  TravelTemplateListQueryDto,
  TravelVersionOperationDto,
  CreateTravelTemplateDto,
  UpdateTravelTemplateDto,
  ApplyTravelTemplateDto,
} from './travel.dto';
import {
  normalizedTemplateItems,
  lockPlan,
  assertCanManagePlan,
  assertCanManageTemplate,
  assertPlanActionable,
  saveOperation,
  templateResponse,
} from './travel.helpers';
import { TravelService } from './travel.service';

/** 出行打包模板：增改查、归档恢复、套用到行程（J7.2 从 TravelService 拆出）。 */
@Injectable()
export class TravelTemplatesService {
  constructor(
    @InjectRepository(TravelPackingTemplate)
    private readonly templates: Repository<TravelPackingTemplate>,
    private readonly dataSource: DataSource,
    private readonly travelService: TravelService,
  ) {}

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
    return templates.map((template) => templateResponse(template, user));
  }

  async createTemplate(dto: CreateTravelTemplateDto, user: JwtUser) {
    const payload = {
      title: normalizedRequiredText(dto.title, '模板名称'),
      description: normalizedText(dto.description),
      items: normalizedTemplateItems(dto.items),
    };
    const key = normalizedRequiredText(dto.idempotencyKey, '幂等键');
    const requestFingerprint = fingerprint({ operation: 'template_create', ...payload });
    const existing = await this.travelService.findOperation(key, requestFingerprint, user);
    if (existing) return this.travelService.operationResult(existing, user);

    try {
      const templateId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.travelService.findOperation(key, requestFingerprint, user, manager);
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
        await saveOperation(manager, user, {
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
      return this.travelService.templateDetail(templateId, user);
    } catch (error) {
      return this.travelService.resolveRace(error, key, requestFingerprint, user);
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
    const existing = await this.travelService.findOperation(key, requestFingerprint, user);
    if (existing) return this.travelService.operationResult(existing, user);

    try {
      const resultPlanId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.travelService.findOperation(key, requestFingerprint, user, manager);
        if (duplicate) return duplicate.planId!;
        const plan = await lockPlan(planId, user, manager);
        assertCanManagePlan(plan, user);
        assertPlanActionable(plan);
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
        await saveOperation(manager, user, {
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
      return this.travelService.detail(resultPlanId, user);
    } catch (error) {
      const constraint = (error as { driverError?: { constraint?: string } })
        ?.driverError?.constraint;
      if (constraint === 'UQ_travel_template_applications_plan_template') {
        throw new ConflictException('这个模板已经应用到当前行程');
      }
      return this.travelService.resolveRace(error, key, requestFingerprint, user);
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
    const existing = await this.travelService.findOperation(key, requestFingerprint, user);
    if (existing) return this.travelService.operationResult(existing, user);
    try {
      const templateId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.travelService.findOperation(key, requestFingerprint, user, manager);
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
        assertCanManageTemplate(template, user);
        if (template.version !== dto.expectedVersion) {
          throw new ConflictException(
            `模板已更新，请刷新后重试（当前 v${template.version}）`,
          );
        }
        await apply(template, manager);
        template.version += 1;
        template.updatedById = user.memberId;
        await manager.getRepository(TravelPackingTemplate).save(template);
        await saveOperation(manager, user, {
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
      return this.travelService.templateDetail(templateId, user);
    } catch (error) {
      return this.travelService.resolveRace(error, key, requestFingerprint, user);
    }
  }
}
