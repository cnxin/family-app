import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  MaintenancePlan,
  ShoppingItem,
} from '../entities';
import { isUniqueViolation } from '@family/shared';
import {
  CreateMaintenanceConsumableDto,
  UpdateMaintenanceConsumableDto,
  AddMaintenanceShoppingDto,
} from './assets.dto';
import { dateOnly, roundQuantity, consumablePreviewRows, lockPlan } from './assets.helpers';

/** 维护计划的耗材：增删改、对照库存预览、把缺的加进购物清单（J7.2 从 AssetsService 拆出）。 */
@Injectable()
export class AssetConsumablesService {
  constructor(
    @InjectRepository(MaintenancePlan)
    private readonly plans: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceConsumable)
    private readonly consumables: Repository<MaintenanceConsumable>,
    private readonly dataSource: DataSource,
  ) {}

  async createConsumable(
    planId: string,
    dto: CreateMaintenanceConsumableDto,
    user: JwtUser,
  ) {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const plan = await lockPlan(planId, user.householdId, manager);
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
        const plan = await lockPlan(
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
      const plan = await lockPlan(
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
    const rows = consumablePreviewRows(plan.consumables ?? [], householdId);
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
      const plan = await lockPlan(planId, user.householdId, manager);
      const links = await manager.getRepository(MaintenanceConsumable).find({
        where: { householdId: user.householdId, planId: plan.id },
        relations: { inventoryItem: true },
        order: { createdAt: 'ASC' },
      });
      if (!links.length) throw new ConflictException('请先为维护计划关联耗材');
      const rows = consumablePreviewRows(links, user.householdId);
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
}
