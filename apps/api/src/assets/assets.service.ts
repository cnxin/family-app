import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { HomeAsset, Household, InventoryTransaction, MaintenanceRecord } from '../entities';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';
import { householdToday } from '@family/shared';
import {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
  RenewSubscriptionDto,
} from './assets.dto';
import {
  WARRANTY_CATEGORIES,
  MaintenanceInventoryConfirmation,
  nullableText,
  dateOnly,
  addMonths,
  present,
  lockAsset,
  assertWarrantyDates,
  cancelScheduledReminders,
} from './assets.helpers';

@Injectable()
export class AssetsService {

  constructor(
    @InjectRepository(HomeAsset)
    private readonly assets: Repository<HomeAsset>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactions: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly facades: PluginFacadeRegistry,
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
    return rows.map((asset) => present(asset, confirmations));
  }

  async get(id: string, householdId: string) {
    const asset = await this.requireAsset(id, householdId);
    const confirmations = await this.loadMaintenanceInventoryConfirmations(
      asset.maintenanceRecords ?? [],
      householdId,
    );
    return present(asset, confirmations);
  }

  async create(dto: CreateAssetDto, user: JwtUser) {
    const purchaseDate = dateOnly(dto.purchaseDate, '购买日期');
    const warrantyExpiresOn = WARRANTY_CATEGORIES.includes(dto.category)
      ? dateOnly(dto.warrantyExpiresOn, '保修到期日')
      : null;
    const renewsOn =
      dto.category === 'subscription'
        ? dateOnly(dto.renewsOn, '续费日期')
        : null;
    const renewalIntervalMonths =
      dto.category === 'subscription'
        ? (dto.renewalIntervalMonths ?? null)
        : null;
    const renewalPrice =
      dto.category === 'subscription' && dto.renewalPrice != null
        ? String(dto.renewalPrice)
        : null;
    assertWarrantyDates(purchaseDate, warrantyExpiresOn);
    const assetId = await this.dataSource.transaction(async (manager) => {
      const assets = manager.getRepository(HomeAsset);
      const asset = await assets.save(
        assets.create({
          householdId: user.householdId,
          name: dto.name.trim(),
          category: dto.category,
          ...(await this.locationFields(manager, user.householdId, dto.locationId, nullableText(dto.location))),
          brand: nullableText(dto.brand),
          model: nullableText(dto.model),
          serialNumber: nullableText(dto.serialNumber),
          purchaseDate,
          purchasePrice:
            dto.purchasePrice == null ? null : String(dto.purchasePrice),
          warrantyExpiresOn,
          renewsOn,
          renewalIntervalMonths,
          renewalPrice,
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

  /** I1：选了位置就清掉旧文本（「整理到位置」）；清掉位置时旧文本不动。 */
  private async locationFields(manager: EntityManager, householdId: string, locationId: string | null | undefined, text: string | null) {
    const usable = (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), householdId, locationId)) ?? null;
    return { locationId: usable, location: usable ? null : text };
  }

  /** 一跳改资产位置（「找不到 → 改」、旧文本「整理到位置」）。 */
  async setLocation(id: string, locationId: string | null, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const asset = await lockAsset(id, user.householdId, manager);
      Object.assign(asset, await this.locationFields(manager, user.householdId, locationId, asset.location));
      await manager.getRepository(HomeAsset).save(asset);
    });
    return this.get(id, user.householdId);
  }

  async update(id: string, dto: UpdateAssetDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const asset = await lockAsset(id, user.householdId, manager);
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
      const nextCategory = dto.category ?? asset.category;
      const nextRenewsOn = Object.prototype.hasOwnProperty.call(dto, 'renewsOn')
        ? dateOnly(dto.renewsOn, '续费日期')
        : asset.renewsOn;
      const effectiveWarranty = WARRANTY_CATEGORIES.includes(nextCategory)
        ? nextWarranty
        : null;
      const effectiveRenewsOn =
        nextCategory === 'subscription' ? nextRenewsOn : null;
      const nextRenewalInterval = Object.prototype.hasOwnProperty.call(
        dto,
        'renewalIntervalMonths',
      )
        ? (dto.renewalIntervalMonths ?? null)
        : asset.renewalIntervalMonths;
      const effectiveRenewalInterval =
        nextCategory === 'subscription' ? nextRenewalInterval : null;
      assertWarrantyDates(nextPurchaseDate, effectiveWarranty);

      if (dto.name != null) asset.name = dto.name.trim();
      if (dto.category != null) asset.category = dto.category;
      if (Object.prototype.hasOwnProperty.call(dto, 'location')) {
        asset.location = nullableText(dto.location);
      }
      if (dto.locationId !== undefined) {
        Object.assign(asset, await this.locationFields(manager, user.householdId, dto.locationId, asset.location));
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
      if (
        Object.prototype.hasOwnProperty.call(dto, 'warrantyExpiresOn') ||
        !WARRANTY_CATEGORIES.includes(nextCategory)
      ) {
        asset.warrantyExpiresOn = effectiveWarranty;
      }
      if (
        Object.prototype.hasOwnProperty.call(dto, 'renewsOn') ||
        nextCategory !== 'subscription'
      ) {
        asset.renewsOn = effectiveRenewsOn;
      }
      if (
        Object.prototype.hasOwnProperty.call(dto, 'renewalIntervalMonths') ||
        nextCategory !== 'subscription'
      ) {
        asset.renewalIntervalMonths = effectiveRenewalInterval;
      }
      if (nextCategory !== 'subscription') {
        asset.renewalPrice = null;
      } else if (Object.prototype.hasOwnProperty.call(dto, 'renewalPrice')) {
        asset.renewalPrice = dto.renewalPrice == null ? null : String(dto.renewalPrice);
      }
      if (Object.prototype.hasOwnProperty.call(dto, 'note')) {
        asset.note = nullableText(dto.note);
      }
      if (dto.status != null) asset.status = dto.status;
      await manager.getRepository(HomeAsset).save(asset);
      const retiredNow = !wasRetired && asset.status === 'retired';
      if (retiredNow) {
        await cancelScheduledReminders(
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

  async renewSubscription(
    id: string,
    dto: RenewSubscriptionDto,
    user: JwtUser,
  ) {
    const timezone = (await this.dataSource.getRepository(Household).findOneByOrFail({ id: user.householdId })).timezone;
    const renewedOn = dateOnly(dto.renewedOn ?? householdToday(timezone, this.clock.now()), '续费完成日期')!;
    await this.dataSource.transaction(async (manager) => {
      const asset = await lockAsset(id, user.householdId, manager);
      if (asset.category !== 'subscription' || asset.status !== 'active') {
        throw new BadRequestException('只有使用中的订阅资产可以标记已续费');
      }
      if (!asset.renewalIntervalMonths) {
        throw new BadRequestException('请先设置订阅的续费周期');
      }
      const previousRenewsOn = asset.renewsOn;
      const baseDate =
        previousRenewsOn && previousRenewsOn >= renewedOn
          ? previousRenewsOn
          : renewedOn;
      asset.renewsOn = addMonths(baseDate, asset.renewalIntervalMonths);
      await manager.getRepository(HomeAsset).save(asset);
      await manager.query(
        `UPDATE agent_routine_items
         SET status = 'expired'
         WHERE "householdId" = $1
           AND "sourceType" = 'subscription_renewal'
           AND "sourceId" = $2
           AND status = 'pending'`,
        [user.householdId, asset.id],
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'subscription_renewed',
        summary: `${user.name} 将订阅「${asset.name}」标记为已续费`,
        detail: `续费日期：${previousRenewsOn ?? '未记录'} → ${asset.renewsOn}`,
        targetPath: `/asset/${asset.id}`,
        metadata: {
          assetId: asset.id,
          previousRenewsOn,
          renewsOn: asset.renewsOn,
          renewalIntervalMonths: asset.renewalIntervalMonths,
        },
      });
    });
    return this.get(id, user.householdId);
  }

  async requireAsset(
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
}
