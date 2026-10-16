import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  Household,
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  MaintenanceConsumableSnapshot,
  MaintenancePlan,
  MaintenanceRecord,
} from '../entities';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';
import { addDays, compare, householdToday, isUniqueViolation } from '@family/shared';
import type { MaintenanceConsumptionLine } from '@family/contracts';
import {
  CreateMaintenancePlanDto,
  UpdateMaintenancePlanDto,
  CompleteMaintenanceDto,
} from './assets.dto';
import {
  nullableText,
  dateOnly,
  consumablePreviewRows,
  lockAsset,
  lockPlan,
  cancelScheduledReminders,
} from './assets.helpers';

/** 资产维护计划：新建、修改、完成（完成时按耗材扣库存、写维护记录、算下次日期、取消已排的提醒）（J7.2 从 AssetsService 拆出）。 */
@Injectable()
export class AssetMaintenanceService {
  constructor(
    @InjectRepository(MaintenancePlan)
    private readonly plans: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceRecord)
    private readonly records: Repository<MaintenanceRecord>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactions: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly facades: PluginFacadeRegistry,
  ) {}

  async createPlan(
    assetId: string,
    dto: CreateMaintenancePlanDto,
    user: JwtUser,
  ) {
    try {
      const planId = await this.dataSource.transaction(async (manager) => {
        const asset = await lockAsset(assetId, user.householdId, manager);
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
        const plan = await lockPlan(id, user.householdId, manager);
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
          await cancelScheduledReminders(
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

      const plan = await lockPlan(id, user.householdId, manager);
      if (!plan.isEnabled || plan.asset.status !== 'active') {
        throw new ConflictException('维护计划已停用或资产已停用');
      }
      const now = this.clock.now();
      const performedAt = now;
      const timezone = (await manager.getRepository(Household).findOneByOrFail({ id: user.householdId })).timezone;
      const performedOn = dateOnly(dto.performedOn, '维护日期')!;
      if (compare(performedOn, householdToday(timezone, now)) > 0) {
        throw new BadRequestException('维护日期不能晚于家庭今天');
      }
      const nextDueDateAfter = addDays(performedOn, plan.frequencyDays);
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
      const rows = consumablePreviewRows(
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
      const consumptionLines: MaintenanceConsumptionLine[] = [];
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
          const transactionId = randomUUID();
          consumptionLines.push({
            inventoryItemId: item.id,
            transactionId,
            quantityBefore: row.quantityBefore,
            quantity: row.quantity,
            quantityAfter: row.quantityAfter,
            unit: row.unit,
          });
          return {
            consumableId: row.consumableId,
            inventoryItemId: row.inventoryItemId,
            inventoryItemName: row.inventoryItemName,
            quantity: row.quantity,
            unit: row.unit,
            consumed: true,
            quantityBefore: row.quantityBefore,
            quantityAfter: row.quantityAfter,
            transactionId,
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
          performedOn,
          cost: dto.cost == null ? null : String(dto.cost),
          note: nullableText(dto.note),
          idempotencyKey,
          nextDueDateBefore: plan.nextDueDate,
          nextDueDateAfter,
          consumablesSnapshot,
          inventoryOperationId: operationId,
        }),
      );
      // 出库走库存门面，传本事务：维护记录与库存流水 / 余量 / 批次扣减同成同败（J1b）
      if (operationId && consumptionLines.length) {
        await this.facades.get('inventory').consumeForMaintenance(toPluginTransaction(manager), {
          householdId: user.householdId,
          operationId,
          recordId,
          actor: user,
          lines: consumptionLines,
        });
      }
      plan.nextDueDate = nextDueDateAfter;
      await manager.getRepository(MaintenancePlan).save(plan);
      await cancelScheduledReminders(
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
}
