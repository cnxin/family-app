import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Response } from 'express';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { memoryStorage } from 'multer';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { jwtSecret } from '../common/config';
import {
  AssetCategory,
  AssetDocument,
  AssetDocumentType,
  AssetStatus,
  HomeAsset,
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  MaintenanceConsumableSnapshot,
  MaintenancePlan,
  MaintenanceRecord,
  Reminder,
  ShoppingItem,
} from '../entities';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { PRIVATE_ASSET_UPLOAD_DIR, UPLOAD_DIR } from '../upload/upload.module';

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
const ASSET_DOCUMENT_ACCESS_TTL_SECONDS = 60;
const ASSET_FILE_PREFIX = 'asset-file://';
const ASSET_DOCUMENT_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

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

class UploadAssetDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: AssetDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;
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

  @IsOptional()
  @IsBoolean()
  consumeInventory?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey: string;
}

class CreateMaintenanceConsumableDto {
  @IsUUID()
  inventoryItemId: string;

  @IsNumber()
  @Min(0.01)
  @Max(99_999_999.99)
  quantity: number;
}

class UpdateMaintenanceConsumableDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(99_999_999.99)
  quantity?: number;
}

class AddMaintenanceShoppingDto {
  @IsISO8601({ strict: true })
  date: string;
}

interface MaintenanceInventoryConfirmation {
  operationId: string | null;
  reversed: boolean;
  transactions: {
    id: string;
    inventoryItemId: string;
    inventoryItemName: string;
    quantityBefore: string;
    delta: string;
    quantityAfter: string;
    unit: string;
    reversedAt: Date | null;
  }[];
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

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

function assertDocumentUrl(value: string) {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // Fall through to the user-facing validation error.
  }
  throw new BadRequestException('资料地址必须使用 HTTP(S)，本地文件请通过上传');
}

function isExternalDocumentUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function uploadedAssetExtension(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return extensions[mimeType] ?? '.bin';
}

function assetDocumentContentType(path: string) {
  const contentTypes: Record<string, string> = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function privateAssetFilePath(householdId: string, url: string) {
  if (!url.startsWith(ASSET_FILE_PREFIX)) return null;
  const fileName = basename(url.slice(ASSET_FILE_PREFIX.length));
  if (!fileName || `${ASSET_FILE_PREFIX}${fileName}` !== url) {
    throw new ForbiddenException('资产资料存储路径无效');
  }
  return resolve(PRIVATE_ASSET_UPLOAD_DIR, householdId, fileName);
}

function legacyAssetFilePath(url: string) {
  if (!url.startsWith('/uploads/')) return null;
  const uploadRoot = resolve(UPLOAD_DIR);
  const path = resolve(uploadRoot, url.slice('/uploads/'.length));
  if (path === uploadRoot || !path.startsWith(`${uploadRoot}${sep}`)) {
    throw new ForbiddenException('资产资料存储路径无效');
  }
  return path;
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === '23505';
}

@Injectable()
export class AssetsService {
  private readonly documentSigningSecret = jwtSecret();

  constructor(
    @InjectRepository(HomeAsset)
    private readonly assets: Repository<HomeAsset>,
    @InjectRepository(AssetDocument)
    private readonly documents: Repository<AssetDocument>,
    @InjectRepository(MaintenancePlan)
    private readonly plans: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceRecord)
    private readonly records: Repository<MaintenanceRecord>,
    @InjectRepository(MaintenanceConsumable)
    private readonly consumables: Repository<MaintenanceConsumable>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactions: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
    private readonly inventoryLedger: InventoryTransactionsService,
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
        maintenancePlans: { consumables: { inventoryItem: true } },
        maintenanceRecords: true,
      },
      order: { status: 'ASC', updatedAt: 'DESC', name: 'ASC' },
      take: 200,
    });
    const confirmations = await this.loadMaintenanceInventoryConfirmations(
      rows.flatMap((asset) => asset.maintenanceRecords ?? []),
      householdId,
    );
    return rows.map((asset) => this.present(asset, confirmations));
  }

  async get(id: string, householdId: string) {
    const asset = await this.requireAsset(id, householdId);
    const confirmations = await this.loadMaintenanceInventoryConfirmations(
      asset.maintenanceRecords ?? [],
      householdId,
    );
    return this.present(asset, confirmations);
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
        targetPath: `/home-assets?assetId=${asset.id}`,
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
        targetPath: `/home-assets?assetId=${asset.id}`,
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
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('资料名称不能为空');
    const asset = await this.requireAsset(assetId, user.householdId, false);
    return this.dataSource.transaction(async (manager) => {
      const documents = manager.getRepository(AssetDocument);
      const document = await documents.save(
        documents.create({
          householdId: user.householdId,
          assetId,
          type: dto.type,
          title,
          url: assertDocumentUrl(dto.url),
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_document_added',
        summary: `${user.name} 为「${asset.name}」添加了资料「${document.title}」`,
        targetPath: `/home-assets?assetId=${asset.id}`,
        metadata: {
          assetId: asset.id,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return this.presentDocument(document);
    });
  }

  async createUploadedDocument(
    assetId: string,
    dto: UploadAssetDocumentDto,
    file: Express.Multer.File | undefined,
    user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('没有收到资产资料文件');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('资料名称不能为空');
    const asset = await this.requireAsset(assetId, user.householdId, false);
    const fileName = `${randomUUID()}${uploadedAssetExtension(file.mimetype)}`;
    const directory = resolve(PRIVATE_ASSET_UPLOAD_DIR, user.householdId);
    const path = resolve(directory, fileName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });

    try {
      const document = await this.dataSource.transaction(async (manager) => {
        const documents = manager.getRepository(AssetDocument);
        const saved = await documents.save(
          documents.create({
            householdId: user.householdId,
            assetId,
            type: dto.type,
            title,
            url: `${ASSET_FILE_PREFIX}${fileName}`,
            createdById: user.memberId,
          }),
        );
        await recordActivity(manager, user, {
          module: 'asset',
          action: 'asset_document_added',
          summary: `${user.name} 为「${asset.name}」上传了资料「${saved.title}」`,
          targetPath: `/home-assets?assetId=${asset.id}`,
          metadata: {
            assetId: asset.id,
            documentId: saved.id,
            documentType: saved.type,
            storage: 'private',
          },
        });
        return saved;
      });
      return this.presentDocument(document);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  async documentAccess(id: string, user: JwtUser) {
    const document = await this.documents.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!document) throw new NotFoundException('资产资料不存在');
    if (isExternalDocumentUrl(document.url)) {
      return { url: document.url, external: true, expiresAt: null };
    }
    const expires =
      Math.floor(Date.now() / 1000) + ASSET_DOCUMENT_ACCESS_TTL_SECONDS;
    const signature = this.signDocumentAccess(document.id, expires);
    return {
      url: `/asset-documents/${document.id}/content?expires=${expires}&signature=${signature}`,
      external: false,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async documentContent(id: string, expiresValue: string, signature: string) {
    const expires = Number(expiresValue);
    this.verifyDocumentAccess(id, expires, signature);
    const document = await this.documents.findOneBy({ id });
    if (!document || isExternalDocumentUrl(document.url)) {
      throw new NotFoundException('资产资料文件不存在');
    }
    const path =
      privateAssetFilePath(document.householdId, document.url) ??
      legacyAssetFilePath(document.url);
    if (!path) throw new NotFoundException('资产资料文件不存在');
    let body: Buffer;
    try {
      body = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('资产资料文件不存在');
      }
      throw error;
    }
    return {
      body,
      contentType: assetDocumentContentType(path),
      fileName: `${document.title}${extname(path).toLowerCase()}`,
    };
  }

  async removeDocument(id: string, user: JwtUser) {
    const removed = await this.dataSource.transaction(async (manager) => {
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
        targetPath: `/home-assets?assetId=${document.assetId}`,
        metadata: {
          assetId: document.assetId,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return {
        result: { id, removed: true as const },
        privatePath: privateAssetFilePath(document.householdId, document.url),
      };
    });
    if (removed.privatePath) {
      await unlink(removed.privatePath).catch(() => undefined);
    }
    return removed.result;
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
          targetPath: `/home-assets?assetId=${asset.id}&planId=${plan.id}`,
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
          targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
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

  async createConsumable(
    planId: string,
    dto: CreateMaintenanceConsumableDto,
    user: JwtUser,
  ) {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const plan = await this.lockPlan(planId, user.householdId, manager);
        if (plan.asset.status !== 'active') {
          throw new ConflictException('停用资产不能新增维护耗材');
        }
        const inventoryItem = await manager
          .getRepository(InventoryItem)
          .findOneBy({ id: dto.inventoryItemId, householdId: user.householdId });
        if (!inventoryItem) throw new NotFoundException('库存项不存在');
        const consumable = await manager.getRepository(MaintenanceConsumable).save(
          manager.getRepository(MaintenanceConsumable).create({
            householdId: user.householdId,
            planId: plan.id,
            inventoryItemId: inventoryItem.id,
            quantity: String(roundQuantity(dto.quantity)),
            unit: inventoryItem.unit,
            createdById: user.memberId,
          }),
        );
        await recordActivity(manager, user, {
          module: 'asset',
          action: 'maintenance_consumable_added',
          summary: `${user.name} 为「${plan.asset.name}」的维护「${plan.title}」关联了耗材「${inventoryItem.name}」`,
          detail: `${roundQuantity(dto.quantity)} ${inventoryItem.unit}`,
          targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
          metadata: {
            assetId: plan.assetId,
            planId: plan.id,
            consumableId: consumable.id,
            inventoryItemId: inventoryItem.id,
          },
        });
        return consumable.id;
      });
      return this.consumables.findOneOrFail({
        where: { id, householdId: user.householdId },
        relations: { inventoryItem: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个维护计划已经关联了该库存项');
      }
      throw error;
    }
  }

  async updateConsumable(
    id: string,
    dto: UpdateMaintenanceConsumableDto,
    user: JwtUser,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        const existing = await manager.getRepository(MaintenanceConsumable).findOneBy({
          id,
          householdId: user.householdId,
        });
        if (!existing) throw new NotFoundException('维护耗材不存在');
        const plan = await this.lockPlan(
          existing.planId,
          user.householdId,
          manager,
        );
        const consumable = await manager
          .getRepository(MaintenanceConsumable)
          .createQueryBuilder('consumable')
          .where('consumable.id = :id', { id })
          .andWhere('consumable.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOneOrFail();
        const inventoryItemId = dto.inventoryItemId ?? consumable.inventoryItemId;
        const inventoryItem = await manager
          .getRepository(InventoryItem)
          .findOneBy({ id: inventoryItemId, householdId: user.householdId });
        if (!inventoryItem) throw new NotFoundException('库存项不存在');
        consumable.inventoryItemId = inventoryItem.id;
        consumable.unit = inventoryItem.unit;
        if (dto.quantity !== undefined) {
          consumable.quantity = String(roundQuantity(dto.quantity));
        }
        await manager.getRepository(MaintenanceConsumable).save(consumable);
        await recordActivity(manager, user, {
          module: 'asset',
          action: 'maintenance_consumable_updated',
          summary: `${user.name} 更新了「${plan.asset.name}」的维护耗材「${inventoryItem.name}」`,
          detail: `${Number(consumable.quantity)} ${consumable.unit}`,
          targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
          metadata: {
            assetId: plan.assetId,
            planId: plan.id,
            consumableId: consumable.id,
            inventoryItemId: inventoryItem.id,
          },
        });
      });
      return this.consumables.findOneOrFail({
        where: { id, householdId: user.householdId },
        relations: { inventoryItem: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个维护计划已经关联了该库存项');
      }
      throw error;
    }
  }

  async removeConsumable(id: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.getRepository(MaintenanceConsumable).findOne({
        where: { id, householdId: user.householdId },
        relations: { inventoryItem: true },
      });
      if (!existing) throw new NotFoundException('维护耗材不存在');
      const plan = await this.lockPlan(
        existing.planId,
        user.householdId,
        manager,
      );
      const result = await manager
        .getRepository(MaintenanceConsumable)
        .delete({ id, householdId: user.householdId });
      if (!result.affected) throw new NotFoundException('维护耗材不存在');
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'maintenance_consumable_removed',
        summary: `${user.name} 移除了「${plan.asset.name}」的维护耗材「${existing.inventoryItem.name}」`,
        targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
        metadata: {
          assetId: plan.assetId,
          planId: plan.id,
          consumableId: existing.id,
          inventoryItemId: existing.inventoryItemId,
        },
      });
      return { id, removed: true as const };
    });
  }

  async consumablesPreview(planId: string, householdId: string) {
    const plan = await this.plans.findOne({
      where: { id: planId, householdId },
      relations: { asset: true, consumables: { inventoryItem: true } },
    });
    if (!plan) throw new NotFoundException('维护计划不存在');
    const rows = this.consumablePreviewRows(plan.consumables ?? [], householdId);
    return {
      planId: plan.id,
      assetId: plan.assetId,
      assetName: plan.asset.name,
      planTitle: plan.title,
      rows,
      canConsume: rows.length > 0 && rows.every((row) => row.status === 'ready'),
      hasShortage: rows.some((row) => row.status === 'insufficient'),
    };
  }

  async addConsumablesToShopping(
    planId: string,
    dto: AddMaintenanceShoppingDto,
    user: JwtUser,
  ) {
    const date = dateOnly(dto.date.slice(0, 10), '采购日期')!;
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `maintenance-shopping:${user.householdId}:${planId}:${date}`,
      ]);
      const plan = await this.lockPlan(planId, user.householdId, manager);
      const links = await manager.getRepository(MaintenanceConsumable).find({
        where: { householdId: user.householdId, planId: plan.id },
        relations: { inventoryItem: true },
        order: { createdAt: 'ASC' },
      });
      if (!links.length) throw new ConflictException('请先为维护计划关联耗材');
      const rows = this.consumablePreviewRows(links, user.householdId);
      const mismatch = rows.find((row) => row.status === 'unit_mismatch');
      if (mismatch) {
        throw new ConflictException(
          `「${mismatch.inventoryItemName}」单位已变化，请先更新耗材关联`,
        );
      }
      const shortages = rows.filter((row) => row.shortage > 0);
      const items = manager.getRepository(ShoppingItem);
      const saved: ShoppingItem[] = [];
      let createdCount = 0;
      let existingCount = 0;
      for (const row of shortages) {
        const existing = await items.findOneBy({
          householdId: user.householdId,
          date,
          maintenanceConsumableId: row.consumableId,
        });
        if (existing) {
          const confirmed = await manager.getRepository(InventoryTransaction).existsBy({
            householdId: user.householdId,
            sourceType: 'shopping_item',
            sourceId: existing.id,
            type: 'receipt',
          });
          if (!confirmed) {
            existing.customName = row.inventoryItemName;
            existing.requiredQty = String(row.quantity);
            existing.availableQty = String(row.quantityBefore);
            existing.totalQty = String(row.shortage);
            existing.unit = row.unit;
            existing.inventoryItemId = row.inventoryItemId;
            existing.source = 'maintenance';
            saved.push(await items.save(existing));
          } else {
            saved.push(existing);
          }
          existingCount += 1;
          continue;
        }
        saved.push(
          await items.save(
            items.create({
              householdId: user.householdId,
              date,
              ingredientId: null,
              customName: row.inventoryItemName,
              totalQty: String(row.shortage),
              requiredQty: String(row.quantity),
              availableQty: String(row.quantityBefore),
              unit: row.unit,
              checked: false,
              source: 'maintenance',
              inventoryItemId: row.inventoryItemId,
              maintenanceConsumableId: row.consumableId,
            }),
          ),
        );
        createdCount += 1;
      }
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'maintenance_consumables_shopping_added',
        summary: shortages.length
          ? `${user.name} 将「${plan.asset.name}」维护缺少的耗材加入了购物清单`
          : `${user.name} 检查了「${plan.asset.name}」的维护耗材，当前库存充足`,
        detail: shortages.length ? `${date} · ${shortages.length} 项` : null,
        targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
        metadata: {
          assetId: plan.assetId,
          planId: plan.id,
          date,
          shoppingItemIds: saved.map((item) => item.id),
        },
      });
      return {
        date,
        createdCount,
        existingCount,
        satisfiedCount: rows.length - shortages.length,
        items: saved,
      };
    });
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
      const consumables = await manager.getRepository(MaintenanceConsumable).find({
        where: { householdId: user.householdId, planId: plan.id },
        relations: { inventoryItem: true },
        order: { inventoryItemId: 'ASC' },
      });
      if (dto.consumeInventory && !consumables.length) {
        throw new ConflictException('维护计划没有可扣减的耗材');
      }
      const lockedItems = dto.consumeInventory
        ? await manager
            .getRepository(InventoryItem)
            .createQueryBuilder('item')
            .where('item.householdId = :householdId', {
              householdId: user.householdId,
            })
            .andWhere('item.id IN (:...inventoryItemIds)', {
              inventoryItemIds: consumables.map((item) => item.inventoryItemId),
            })
            .orderBy('item.id', 'ASC')
            .setLock('pessimistic_write')
            .getMany()
        : [];
      if (dto.consumeInventory && lockedItems.length !== consumables.length) {
        throw new NotFoundException('相关库存项不存在');
      }
      const rows = this.consumablePreviewRows(
        consumables.map((consumable) => ({
          ...consumable,
          inventoryItem:
            lockedItems.find((item) => item.id === consumable.inventoryItemId) ??
            consumable.inventoryItem,
        })) as MaintenanceConsumable[],
        user.householdId,
      );
      if (dto.consumeInventory) {
        const mismatch = rows.find((row) => row.status === 'unit_mismatch');
        if (mismatch) {
          throw new ConflictException(
            `「${mismatch.inventoryItemName}」单位已变化，请先更新耗材关联`,
          );
        }
        const insufficient = rows.find((row) => row.status === 'insufficient');
        if (insufficient) {
          throw new ConflictException(
            `「${insufficient.inventoryItemName}」库存不足，需要 ${insufficient.quantity} ${insufficient.unit}`,
          );
        }
      }
      const recordId = randomUUID();
      const operationId = dto.consumeInventory ? randomUUID() : null;
      const pendingTransactions: {
        item: InventoryItem;
        transaction: InventoryTransaction;
      }[] = [];
      const consumablesSnapshot: MaintenanceConsumableSnapshot[] = rows.map(
        (row) => {
          if (!dto.consumeInventory || row.quantityAfter == null || !operationId) {
            return {
              consumableId: row.consumableId,
              inventoryItemId: row.inventoryItemId,
              inventoryItemName: row.inventoryItemName,
              quantity: row.quantity,
              unit: row.unit,
              consumed: false,
              quantityBefore: null,
              quantityAfter: null,
              transactionId: null,
            };
          }
          const item = lockedItems.find(
            (candidate) => candidate.id === row.inventoryItemId,
          );
          if (!item) throw new NotFoundException('相关库存项不存在');
          const transaction = this.inventoryLedger.createTransaction(manager, {
            householdId: user.householdId,
            inventoryItemId: item.id,
            operationId,
            type: 'consumption',
            quantityBefore: row.quantityBefore,
            delta: -row.quantity,
            quantityAfter: row.quantityAfter,
            unit: row.unit,
            actor: user,
            sourceType: 'maintenance_record',
            sourceId: recordId,
            idempotencyKey: `maintenance-record:${recordId}:consumption:${item.id}`,
          });
          transaction.id = randomUUID();
          pendingTransactions.push({ item, transaction });
          return {
            consumableId: row.consumableId,
            inventoryItemId: row.inventoryItemId,
            inventoryItemName: row.inventoryItemName,
            quantity: row.quantity,
            unit: row.unit,
            consumed: true,
            quantityBefore: row.quantityBefore,
            quantityAfter: row.quantityAfter,
            transactionId: transaction.id,
          };
        },
      );
      const record = await manager.getRepository(MaintenanceRecord).save(
        manager.getRepository(MaintenanceRecord).create({
          id: recordId,
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
          consumablesSnapshot,
          inventoryOperationId: operationId,
        }),
      );
      for (const pending of pendingTransactions) {
        pending.item.quantity = pending.transaction.quantityAfter;
        await manager.getRepository(InventoryItem).save(pending.item);
        await manager
          .getRepository(InventoryTransaction)
          .save(pending.transaction);
      }
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
        targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
        metadata: {
          assetId: plan.assetId,
          planId: plan.id,
          recordId: record.id,
          performedAt: record.performedAt.toISOString(),
          nextDueDateBefore: record.nextDueDateBefore,
          nextDueDateAfter: record.nextDueDateAfter,
          cost: record.cost,
          inventoryOperationId: record.inventoryOperationId,
          consumableCount: consumablesSnapshot.length,
          consumedInventory: Boolean(record.inventoryOperationId),
        },
      });
      return { alreadyCompleted: false, recordId: record.id };
    });

    const [record, plan, transactions] = await Promise.all([
      this.records.findOneByOrFail({
        id: result.recordId,
        householdId: user.householdId,
      }),
      this.plans.findOneByOrFail({ id, householdId: user.householdId }),
      this.inventoryTransactions.find({
        where: {
          householdId: user.householdId,
          sourceType: 'maintenance_record',
          sourceId: result.recordId,
          type: 'consumption',
        },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    return {
      alreadyCompleted: result.alreadyCompleted,
      record,
      plan,
      transactions,
    };
  }

  private consumablePreviewRows(
    consumables: MaintenanceConsumable[],
    householdId: string,
  ) {
    return consumables.map((consumable) => {
      const item = consumable.inventoryItem;
      if (!item || item.householdId !== householdId) {
        throw new ConflictException('维护耗材关联的库存项无效');
      }
      const quantity = roundQuantity(Number(consumable.quantity));
      const quantityBefore = roundQuantity(Number(item.quantity));
      if (!Number.isFinite(quantity) || !Number.isFinite(quantityBefore)) {
        throw new ConflictException('维护耗材或库存数量无效');
      }
      const unitMatches = item.unit === consumable.unit;
      const quantityAfter = unitMatches
        ? roundQuantity(quantityBefore - quantity)
        : null;
      const status: 'ready' | 'unit_mismatch' | 'insufficient' = !unitMatches
        ? 'unit_mismatch'
        : quantityAfter != null && quantityAfter < 0
          ? 'insufficient'
          : 'ready';
      return {
        consumableId: consumable.id,
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        quantity,
        unit: consumable.unit,
        currentUnit: item.unit,
        quantityBefore,
        quantityAfter,
        shortage: unitMatches
          ? roundQuantity(Math.max(quantity - quantityBefore, 0))
          : quantity,
        status,
      };
    });
  }

  private signDocumentAccess(id: string, expires: number) {
    return createHmac('sha256', this.documentSigningSecret)
      .update(`asset-document:${id}:${expires}`)
      .digest('base64url');
  }

  private verifyDocumentAccess(
    id: string,
    expires: number,
    signature: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + ASSET_DOCUMENT_ACCESS_TTL_SECONDS + 5
    ) {
      throw new ForbiddenException('资产资料链接已过期');
    }
    const expected = Buffer.from(
      this.signDocumentAccess(id, expires),
      'utf8',
    );
    const received = Buffer.from(signature || '', 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('资产资料链接无效');
    }
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
            maintenancePlans: { consumables: { inventoryItem: true } },
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

  private async loadMaintenanceInventoryConfirmations(
    records: MaintenanceRecord[],
    householdId: string,
  ) {
    const recordIds = records.map((record) => record.id);
    const consumptions = recordIds.length
      ? await this.inventoryTransactions.find({
          where: {
            householdId,
            sourceType: 'maintenance_record',
            sourceId: In(recordIds),
            type: 'consumption',
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    const reversals = consumptions.length
      ? await this.inventoryTransactions.find({
          where: {
            householdId,
            reversesTransactionId: In(consumptions.map((row) => row.id)),
          },
        })
      : [];
    const reversalByOriginal = new Map(
      reversals.map((row) => [row.reversesTransactionId, row]),
    );
    const transactionsByRecord = new Map<string, InventoryTransaction[]>();
    for (const transaction of consumptions) {
      transactionsByRecord.set(transaction.sourceId, [
        ...(transactionsByRecord.get(transaction.sourceId) ?? []),
        transaction,
      ]);
    }
    const recordById = new Map(records.map((record) => [record.id, record]));
    const confirmations = new Map<string, MaintenanceInventoryConfirmation>();
    for (const [recordId, transactions] of transactionsByRecord) {
      const record = recordById.get(recordId);
      confirmations.set(recordId, {
        operationId: record?.inventoryOperationId ?? null,
        reversed: transactions.every((transaction) =>
          reversalByOriginal.has(transaction.id),
        ),
        transactions: transactions.map((transaction) => ({
          id: transaction.id,
          inventoryItemId: transaction.inventoryItemId,
          inventoryItemName: transaction.inventoryItem.name,
          quantityBefore: transaction.quantityBefore,
          delta: transaction.delta,
          quantityAfter: transaction.quantityAfter,
          unit: transaction.unit,
          reversedAt: reversalByOriginal.get(transaction.id)?.createdAt ?? null,
        })),
      });
    }
    return confirmations;
  }

  private present(
    asset: HomeAsset,
    inventoryConfirmations: Map<string, MaintenanceInventoryConfirmation>,
  ) {
    return {
      ...asset,
      documents: [...(asset.documents ?? [])]
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .map((document) => this.presentDocument(document)),
      maintenancePlans: [...(asset.maintenancePlans ?? [])]
        .map((plan) => ({
          ...plan,
          consumables: [...(plan.consumables ?? [])].sort((left, right) =>
            left.inventoryItem.name.localeCompare(
              right.inventoryItem.name,
              'zh-CN',
            ),
          ),
        }))
        .sort(
          (left, right) =>
            Number(right.isEnabled) - Number(left.isEnabled) ||
            left.nextDueDate.localeCompare(right.nextDueDate) ||
            left.title.localeCompare(right.title, 'zh-CN'),
        ),
      maintenanceRecords: [...(asset.maintenanceRecords ?? [])]
        .map((record) => ({
          ...record,
          inventoryConfirmation: inventoryConfirmations.get(record.id) ?? null,
        }))
        .sort(
          (left, right) =>
            right.performedAt.getTime() - left.performedAt.getTime(),
        ),
    };
  }

  private presentDocument(document: AssetDocument) {
    return {
      ...document,
      url: isExternalDocumentUrl(document.url) ? document.url : null,
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

  @Post('assets/:id/documents/upload')
  @RequireCapabilities('manage_assets')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) =>
        ASSET_DOCUMENT_MIME_TYPES.has(file.mimetype)
          ? callback(null, true)
          : callback(
              new BadRequestException('资产资料只支持图片或 PDF 文件'),
              false,
            ),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadDocument(
    @Param('id') id: string,
    @Body() dto: UploadAssetDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createUploadedDocument(id, dto, file, user);
  }

  @Get('asset-documents/:id/access')
  documentAccess(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.documentAccess(id, user);
  }

  @Public()
  @Get('asset-documents/:id/content')
  async documentContent(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ) {
    const content = await this.service.documentContent(
      id,
      expires,
      signature,
    );
    const extension = extname(content.fileName).toLowerCase();
    response.setHeader('Content-Type', content.contentType);
    response.setHeader('Content-Length', String(content.body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="asset-document${extension}"; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
    );
    response.status(200).end(content.body);
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

  @Post('maintenance-plans/:id/consumables')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  createConsumable(
    @Param('id') id: string,
    @Body() dto: CreateMaintenanceConsumableDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createConsumable(id, dto, user);
  }

  @Patch('maintenance-consumables/:id')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  updateConsumable(
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceConsumableDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateConsumable(id, dto, user);
  }

  @Delete('maintenance-consumables/:id')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  removeConsumable(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.removeConsumable(id, user);
  }

  @Get('maintenance-plans/:id/consumables-preview')
  consumablesPreview(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.consumablesPreview(id, user.householdId);
  }

  @Post('maintenance-plans/:id/shopping-items')
  @RequireCapabilities('manage_assets', 'manage_shopping')
  addConsumablesToShopping(
    @Param('id') id: string,
    @Body() dto: AddMaintenanceShoppingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addConsumablesToShopping(id, dto, user);
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
    InventoryModule,
    TypeOrmModule.forFeature([
      HomeAsset,
      AssetDocument,
      MaintenancePlan,
      MaintenanceRecord,
      MaintenanceConsumable,
      InventoryItem,
      InventoryTransaction,
      ShoppingItem,
      Reminder,
    ]),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
