import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  AssetCategory,
  AssetDocument,
  AssetDocumentType,
  AssetStatus,
  HomeAsset,
  MaintenancePlan,
  MaintenanceRecord,
  Reminder,
} from '../entities';

const ASSET_CATEGORIES: AssetCategory[] = [
  'appliance',
  'furniture',
  'electronics',
  'tool',
  'other',
];
const DOCUMENT_TYPES: AssetDocumentType[] = [
  'receipt',
  'manual',
  'warranty',
  'other',
];

class AssetListQueryDto {
  @IsOptional()
  @IsIn(['active', 'retired', 'all'])
  status?: AssetStatus | 'all';

  @IsOptional()
  @IsIn(ASSET_CATEGORIES)
  category?: AssetCategory;
}

class CreateAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsIn(ASSET_CATEGORIES)
  category: AssetCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  purchasePrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  warrantyExpiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(ASSET_CATEGORIES)
  category?: AssetCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  purchasePrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  warrantyExpiresOn?: string | null;

  @IsOptional()
  @IsIn(['active', 'retired'])
  status?: AssetStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class CreateAssetDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: AssetDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url: string;
}

class CreateMaintenancePlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  frequencyDays: number;

  @IsString()
  @MaxLength(10)
  nextDueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class UpdateMaintenancePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  frequencyDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  nextDueDate?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class CompleteMaintenanceDto {
  @IsOptional()
  @IsString()
  performedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  cost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey: string;
}

function nullableText(value: string | null | undefined) {
  return value?.trim() || null;
}

function dateOnly(value: string | null | undefined, label: string) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label}必须使用 YYYY-MM-DD 格式`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label}不是有效日期`);
  }
  return value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertDocumentUrl(value: string) {
  const url = value.trim();
  if (url.startsWith('/uploads/')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // Fall through to the user-facing validation error.
  }
  throw new BadRequestException('资料地址必须是上传文件或 HTTP(S) 链接');
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === '23505';
}

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(HomeAsset)
    private readonly assets: Repository<HomeAsset>,
    @InjectRepository(AssetDocument)
    private readonly documents: Repository<AssetDocument>,
    @InjectRepository(MaintenancePlan)
    private readonly plans: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceRecord)
    private readonly records: Repository<MaintenanceRecord>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: AssetListQueryDto, householdId: string) {
    const rows = await this.assets.find({
      where: {
        householdId,
        ...(query.status && query.status !== 'all'
          ? { status: query.status }
          : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      relations: {
        documents: true,
        maintenancePlans: true,
        maintenanceRecords: true,
      },
      order: { status: 'ASC', updatedAt: 'DESC', name: 'ASC' },
      take: 200,
    });
    return rows.map((asset) => this.present(asset));
  }

  async get(id: string, householdId: string) {
    return this.present(await this.requireAsset(id, householdId));
  }

  async create(dto: CreateAssetDto, user: JwtUser) {
    const purchaseDate = dateOnly(dto.purchaseDate, '购买日期');
    const warrantyExpiresOn = dateOnly(dto.warrantyExpiresOn, '保修到期日');
    this.assertWarrantyDates(purchaseDate, warrantyExpiresOn);
    const assetId = await this.dataSource.transaction(async (manager) => {
      const assets = manager.getRepository(HomeAsset);
      const asset = await assets.save(
        assets.create({
          householdId: user.householdId,
          name: dto.name.trim(),
          category: dto.category,
          location: nullableText(dto.location),
          brand: nullableText(dto.brand),
          model: nullableText(dto.model),
          serialNumber: nullableText(dto.serialNumber),
          purchaseDate,
          purchasePrice:
            dto.purchasePrice == null ? null : String(dto.purchasePrice),
          warrantyExpiresOn,
          status: 'active',
          note: nullableText(dto.note),
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_created',
        summary: `${user.name} 新增了家庭资产「${asset.name}」`,
        targetPath: `/assets?assetId=${asset.id}`,
        metadata: { assetId: asset.id, category: asset.category },
      });
      return asset.id;
    });
    return this.get(assetId, user.householdId);
  }

  async update(id: string, dto: UpdateAssetDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const asset = await this.lockAsset(id, user.householdId, manager);
      const wasRetired = asset.status === 'retired';
      const nextPurchaseDate = Object.prototype.hasOwnProperty.call(
        dto,
        'purchaseDate',
      )
        ? dateOnly(dto.purchaseDate, '购买日期')
        : asset.purchaseDate;
      const nextWarranty = Object.prototype.hasOwnProperty.call(
        dto,
        'warrantyExpiresOn',
      )
        ? dateOnly(dto.warrantyExpiresOn, '保修到期日')
        : asset.warrantyExpiresOn;
      this.assertWarrantyDates(nextPurchaseDate, nextWarranty);

      if (dto.name != null) asset.name = dto.name.trim();
      if (dto.category != null) asset.category = dto.category;
      if (Object.prototype.hasOwnProperty.call(dto, 'location')) {
        asset.location = nullableText(dto.location);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'brand')) {
        asset.brand = nullableText(dto.brand);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'model')) {
        asset.model = nullableText(dto.model);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'serialNumber')) {
        asset.serialNumber = nullableText(dto.serialNumber);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'purchaseDate')) {
        asset.purchaseDate = nextPurchaseDate;
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'purchasePrice')) {
        asset.purchasePrice =
          dto.purchasePrice == null ? null : String(dto.purchasePrice);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'warrantyExpiresOn')) {
        asset.warrantyExpiresOn = nextWarranty;
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'note')) {
        asset.note = nullableText(dto.note);
      }
      if (dto.status != null) asset.status = dto.status;
      await manager.getRepository(HomeAsset).save(asset);
      const retiredNow = !wasRetired && asset.status === 'retired';
      if (retiredNow) {
        await this.cancelScheduledReminders(
          manager,
          user.householdId,
          asset.id,
          null,
          'asset_retired',
        );
      }
      await recordActivity(manager, user, {
        module: 'asset',
        action: retiredNow ? 'asset_retired' : 'asset_updated',
        summary:
          retiredNow
            ? `${user.name} 归档了家庭资产「${asset.name}」`
            : `${user.name} 更新了家庭资产「${asset.name}」`,
        detail: `修改字段：${Object.keys(dto).join('、')}`,
        targetPath: `/assets?assetId=${asset.id}`,
        metadata: {
          assetId: asset.id,
          changedFields: Object.keys(dto),
          status: asset.status,
        },
      });
    });
    return this.get(id, user.householdId);
  }

  async createDocument(
    assetId: string,
    dto: CreateAssetDocumentDto,
    user: JwtUser,
  ) {
    const asset = await this.requireAsset(assetId, user.householdId, false);
    return this.dataSource.transaction(async (manager) => {
      const documents = manager.getRepository(AssetDocument);
      const document = await documents.save(
        documents.create({
          householdId: user.householdId,
          assetId,
          type: dto.type,
          title: dto.title.trim(),
          url: assertDocumentUrl(dto.url),
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_document_added',
        summary: `${user.name} 为「${asset.name}」添加了资料「${document.title}」`,
        targetPath: `/assets?assetId=${asset.id}`,
        metadata: {
          assetId: asset.id,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return document;
    });
  }

  async removeDocument(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const documents = manager.getRepository(AssetDocument);
      const document = await documents.findOne({
        where: { id, householdId: user.householdId },
        relations: { asset: true },
      });
      if (!document) throw new NotFoundException('资产资料不存在');
      await documents.delete({ id, householdId: user.householdId });
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_document_removed',
        summary: `${user.name} 移除了「${document.asset.name}」的资料「${document.title}」`,
        targetPath: `/assets?assetId=${document.assetId}`,
        metadata: {
          assetId: document.assetId,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return { id, removed: true };
    });
  }

  async createPlan(
    assetId: string,
    dto: CreateMaintenancePlanDto,
    user: JwtUser,
  ) {
    try {
      const planId = await this.dataSource.transaction(async (manager) => {
        const asset = await this.lockAsset(assetId, user.householdId, manager);
        if (asset.status !== 'active') {
          throw new ConflictException('停用资产不能新增维护计划');
        }
        const plans = manager.getRepository(MaintenancePlan);
        const plan = await plans.save(
          plans.create({
            householdId: user.householdId,
            assetId,
            title: dto.title.trim(),
            frequencyDays: dto.frequencyDays,
            nextDueDate: dateOnly(dto.nextDueDate, '下次维护日期')!,
            isEnabled: true,
            note: nullableText(dto.note),
            createdById: user.memberId,
          }),
        );
        await recordActivity(manager, user, {
          module: 'asset',
          action: 'maintenance_plan_created',
          summary: `${user.name} 为「${asset.name}」创建了维护计划「${plan.title}」`,
          targetPath: `/assets?assetId=${asset.id}&planId=${plan.id}`,
          metadata: {
            assetId: asset.id,
            planId: plan.id,
            frequencyDays: plan.frequencyDays,
            nextDueDate: plan.nextDueDate,
          },
        });
        return plan.id;
      });
      return this.plans.findOneByOrFail({
        id: planId,
        householdId: user.householdId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个资产已经有同名维护计划');
      }
      throw error;
    }
  }

  async updatePlan(
    id: string,
    dto: UpdateMaintenancePlanDto,
    user: JwtUser,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        const plan = await this.lockPlan(id, user.householdId, manager);
        if (dto.title != null) plan.title = dto.title.trim();
        if (dto.frequencyDays != null) {
          plan.frequencyDays = dto.frequencyDays;
        }
        if (dto.nextDueDate != null) {
          plan.nextDueDate = dateOnly(
            dto.nextDueDate,
            '下次维护日期',
          )!;
        }
        if (Object.prototype.hasOwnProperty.call(dto, 'note')) {
          plan.note = nullableText(dto.note);
        }
        if (dto.isEnabled != null) plan.isEnabled = dto.isEnabled;
        await manager.getRepository(MaintenancePlan).save(plan);
        if (!plan.isEnabled) {
          await this.cancelScheduledReminders(
            manager,
            user.householdId,
            plan.assetId,
            plan.id,
            'maintenance_disabled',
          );
        }
        await recordActivity(manager, user, {
          module: 'asset',
          action: plan.isEnabled
            ? 'maintenance_plan_updated'
            : 'maintenance_plan_disabled',
          summary: plan.isEnabled
            ? `${user.name} 更新了「${plan.asset.name}」的维护计划「${plan.title}」`
            : `${user.name} 停用了「${plan.asset.name}」的维护计划「${plan.title}」`,
          detail: `修改字段：${Object.keys(dto).join('、')}`,
          targetPath: `/assets?assetId=${plan.assetId}&planId=${plan.id}`,
          metadata: {
            assetId: plan.assetId,
            planId: plan.id,
            changedFields: Object.keys(dto),
            isEnabled: plan.isEnabled,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个资产已经有同名维护计划');
      }
      throw error;
    }
    return this.plans.findOneByOrFail({ id, householdId: user.householdId });
  }

  async completePlan(
    id: string,
    dto: CompleteMaintenanceDto,
    user: JwtUser,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `maintenance-plan:${user.householdId}:${id}`,
      ]);
      const idempotencyKey = `maintenance:${dto.idempotencyKey.trim()}`;
      const existing = await manager.getRepository(MaintenanceRecord).findOneBy({
        householdId: user.householdId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.planId !== id) {
          throw new ConflictException('这个幂等键已经用于其他维护记录');
        }
        return { alreadyCompleted: true, recordId: existing.id };
      }

      const plan = await this.lockPlan(id, user.householdId, manager);
      if (!plan.isEnabled || plan.asset.status !== 'active') {
        throw new ConflictException('维护计划已停用或资产已停用');
      }
      const performedAt = dto.performedAt
        ? new Date(dto.performedAt)
        : new Date();
      if (!Number.isFinite(performedAt.getTime())) {
        throw new BadRequestException('维护时间无效');
      }
      if (performedAt.getTime() > Date.now() + 5 * 60_000) {
        throw new BadRequestException('维护时间不能晚于当前时间');
      }
      const performedDate = performedAt.toISOString().slice(0, 10);
      const nextDueDateAfter = addDays(performedDate, plan.frequencyDays);
      const record = await manager.getRepository(MaintenanceRecord).save(
        manager.getRepository(MaintenanceRecord).create({
          householdId: user.householdId,
          assetId: plan.assetId,
          planId: plan.id,
          performedById: user.memberId,
          performedAt,
          cost: dto.cost == null ? null : String(dto.cost),
          note: nullableText(dto.note),
          idempotencyKey,
          nextDueDateBefore: plan.nextDueDate,
          nextDueDateAfter,
        }),
      );
      plan.nextDueDate = nextDueDateAfter;
      await manager.getRepository(MaintenancePlan).save(plan);
      await this.cancelScheduledReminders(
        manager,
        user.householdId,
        plan.assetId,
        plan.id,
        'source_rescheduled',
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'maintenance_completed',
        summary: `${user.name} 完成了「${plan.asset.name}」的维护「${plan.title}」`,
        detail: record.note,
        targetPath: `/assets?assetId=${plan.assetId}&planId=${plan.id}`,
        metadata: {
          assetId: plan.assetId,
          planId: plan.id,
          recordId: record.id,
          performedAt: record.performedAt.toISOString(),
          nextDueDateBefore: record.nextDueDateBefore,
          nextDueDateAfter: record.nextDueDateAfter,
          cost: record.cost,
        },
      });
      return { alreadyCompleted: false, recordId: record.id };
    });

    const [record, plan] = await Promise.all([
      this.records.findOneByOrFail({
        id: result.recordId,
        householdId: user.householdId,
      }),
      this.plans.findOneByOrFail({ id, householdId: user.householdId }),
    ]);
    return { alreadyCompleted: result.alreadyCompleted, record, plan };
  }

  private async requireAsset(
    id: string,
    householdId: string,
    withRelations = true,
  ) {
    const asset = await this.assets.findOne({
      where: { id, householdId },
      relations: withRelations
        ? {
            documents: true,
            maintenancePlans: true,
            maintenanceRecords: true,
          }
        : {},
    });
    if (!asset) throw new NotFoundException('家庭资产不存在');
    return asset;
  }

  private async lockAsset(
    id: string,
    householdId: string,
    manager: EntityManager,
  ) {
    const asset = await manager
      .getRepository(HomeAsset)
      .createQueryBuilder('asset')
      .where('asset.id = :id', { id })
      .andWhere('asset.householdId = :householdId', { householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!asset) throw new NotFoundException('家庭资产不存在');
    return asset;
  }

  private async lockPlan(
    id: string,
    householdId: string,
    manager: EntityManager,
  ) {
    const plan = await manager
      .getRepository(MaintenancePlan)
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.asset', 'asset')
      .where('plan.id = :id', { id })
      .andWhere('plan.householdId = :householdId', { householdId })
      .andWhere('asset.householdId = :householdId', { householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!plan) throw new NotFoundException('维护计划不存在');
    return plan;
  }

  private assertWarrantyDates(
    purchaseDate: string | null,
    warrantyExpiresOn: string | null,
  ) {
    if (
      purchaseDate &&
      warrantyExpiresOn &&
      warrantyExpiresOn < purchaseDate
    ) {
      throw new BadRequestException('保修到期日不能早于购买日期');
    }
  }

  private async cancelScheduledReminders(
    manager: EntityManager,
    householdId: string,
    assetId: string,
    planId: string | null,
    reason: string,
  ) {
    const plans = planId
      ? [planId]
      : (
          await manager.getRepository(MaintenancePlan).findBy({
            householdId,
            assetId,
          })
        ).map((plan) => plan.id);
    if (!plans.length) return;
    await manager
      .getRepository(Reminder)
      .createQueryBuilder()
      .update()
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where('"householdId" = :householdId', { householdId })
      .andWhere('"sourceModule" = :sourceModule', {
        sourceModule: 'maintenance',
      })
      .andWhere('"sourceId" IN (:...plans)', { plans })
      .andWhere('status = :status', { status: 'scheduled' })
      .execute();
  }

  private present(asset: HomeAsset) {
    return {
      ...asset,
      documents: [...(asset.documents ?? [])].sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime(),
      ),
      maintenancePlans: [...(asset.maintenancePlans ?? [])].sort(
        (left, right) =>
          Number(right.isEnabled) - Number(left.isEnabled) ||
          left.nextDueDate.localeCompare(right.nextDueDate) ||
          left.title.localeCompare(right.title, 'zh-CN'),
      ),
      maintenanceRecords: [...(asset.maintenanceRecords ?? [])].sort(
        (left, right) =>
          right.performedAt.getTime() - left.performedAt.getTime(),
      ),
    };
  }
}

@Controller()
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get('assets')
  list(@Query() query: AssetListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user.householdId);
  }

  @Get('assets/:id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.get(id, user.householdId);
  }

  @Post('assets')
  @RequireCapabilities('manage_assets')
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('assets/:id')
  @RequireCapabilities('manage_assets')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('assets/:id/documents')
  @RequireCapabilities('manage_assets')
  createDocument(
    @Param('id') id: string,
    @Body() dto: CreateAssetDocumentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createDocument(id, dto, user);
  }

  @Delete('asset-documents/:id')
  @RequireCapabilities('manage_assets')
  removeDocument(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.removeDocument(id, user);
  }

  @Post('assets/:id/maintenance-plans')
  @RequireCapabilities('manage_assets')
  createPlan(
    @Param('id') id: string,
    @Body() dto: CreateMaintenancePlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createPlan(id, dto, user);
  }

  @Patch('maintenance-plans/:id')
  @RequireCapabilities('manage_assets')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateMaintenancePlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePlan(id, dto, user);
  }

  @Post('maintenance-plans/:id/complete')
  @RequireCapabilities('manage_assets')
  completePlan(
    @Param('id') id: string,
    @Body() dto: CompleteMaintenanceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.completePlan(id, dto, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HomeAsset,
      AssetDocument,
      MaintenancePlan,
      MaintenanceRecord,
      Reminder,
    ]),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
