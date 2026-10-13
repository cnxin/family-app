import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  Ingredient,
  InventoryBatch,
  InventoryItem,
  InventoryTransaction,
  MaintenanceConsumable,
  ShoppingItem,
} from '../entities';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';
import { isUniqueViolation } from '@family/shared';
import { CreateInventoryItemDto, UpdateInventoryItemDto } from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private readonly items: Repository<InventoryItem>,
    @InjectRepository(InventoryTransaction)
    private readonly transactions: Repository<InventoryTransaction>,
    @InjectRepository(InventoryBatch)
    private readonly batches: Repository<InventoryBatch>,
    private readonly dataSource: DataSource,
    private readonly ledger: InventoryTransactionsService,
    private readonly batchService: InventoryBatchesService,
    private readonly facades: PluginFacadeRegistry,
  ) {}

  async list(householdId: string) {
    const items = await this.items.find({
      where: { householdId },
      order: { category: 'ASC', name: 'ASC' },
    });
    const summaries = await this.batchService.summaries(householdId, items);
    return items.map((item) => ({
      ...item,
      batchSummary: summaries.get(item.id),
    }));
  }

  async create(dto: CreateInventoryItemDto, user: JwtUser) {
    const name = dto.name.trim();
    const unit = dto.unit.trim();
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(InventoryItem);
        if (await items.findOneBy({ householdId: user.householdId, name })) {
          throw new ConflictException(`库存中已经有「${name}」`);
        }
        if (dto.ingredientId) {
          const ingredient = await manager.getRepository(Ingredient).findOneBy({
            id: dto.ingredientId,
            householdId: user.householdId,
          });
          if (!ingredient) throw new NotFoundException('关联食材不存在');
          const duplicate = await items.findOneBy({
            householdId: user.householdId,
            ingredientId: dto.ingredientId,
            unit,
          });
          if (duplicate) {
            throw new ConflictException('这个食材和单位已经关联了库存');
          }
        }
        const defaultLocationId = (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), user.householdId, dto.defaultLocationId)) ?? null;
        const item = await items.save(
          items.create({
            householdId: user.householdId,
            defaultLocationId,
            ingredientId: dto.ingredientId ?? null,
            name,
            category: dto.category,
            unit,
            quantity: String(dto.quantity),
            lowStockThreshold: String(dto.lowStockThreshold),
            restockQuantity: String(dto.restockQuantity),
          }),
        );
        if (dto.quantity > 0) {
          await manager.getRepository(InventoryTransaction).save(
            this.ledger.createTransaction(manager, {
              householdId: user.householdId,
              inventoryItemId: item.id,
              operationId: randomUUID(),
              type: 'adjustment',
              quantityBefore: 0,
              delta: dto.quantity,
              quantityAfter: dto.quantity,
              unit,
              actor: user,
              sourceType: 'inventory_item',
              sourceId: item.id,
              idempotencyKey: `inventory-item:${item.id}:initial`,
            }),
          );
        }
        return item.id;
      });
      return this.reload(id, user.householdId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('同名库存或食材单位关联已经存在');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateInventoryItemDto, user: JwtUser) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(InventoryItem);
        const item = await items
          .createQueryBuilder('item')
          .where('item.id = :id', { id })
          .andWhere('item.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!item) throw new NotFoundException('库存项不存在');

        if (dto.defaultLocationId !== undefined) {
          item.defaultLocationId = (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), user.householdId, dto.defaultLocationId)) ?? null;
          await items.update({ id: item.id }, { defaultLocationId: item.defaultLocationId });
        }
        const quantityBefore = Number(item.quantity);
        const quantityAfter = dto.quantity ?? quantityBefore;
        const quantityChanged = quantityAfter !== quantityBefore;
        const adjustmentKey = dto.idempotencyKey?.trim();
        if (adjustmentKey) {
          const existingAdjustment = await manager
            .getRepository(InventoryTransaction)
            .findOneBy({
              householdId: user.householdId,
              idempotencyKey: `manual-adjustment:${adjustmentKey}`,
            });
          if (existingAdjustment) {
            if (
              existingAdjustment.sourceId === item.id &&
              Number(existingAdjustment.quantityAfter) === quantityAfter
            ) {
              return;
            }
            throw new ConflictException('这个幂等键已经用于其他库存变化');
          }
        }
        const nextUnit = dto.unit == null ? item.unit : dto.unit.trim();
        if (nextUnit !== item.unit && quantityChanged) {
          throw new ConflictException('不能同时修改库存单位和数量');
        }
        if (nextUnit !== item.unit && quantityBefore !== 0) {
          throw new ConflictException('库存归零后才能修改单位');
        }
        if (quantityChanged && !adjustmentKey) {
          throw new BadRequestException('修改库存数量需要幂等键');
        }

        if (dto.name != null) {
          const name = dto.name.trim();
          const duplicate = await items.findOneBy({
            householdId: user.householdId,
            name,
          });
          if (duplicate && duplicate.id !== id) {
            throw new ConflictException(`库存中已经有「${name}」`);
          }
          item.name = name;
        }
        const nextIngredientId =
          dto.ingredientId === undefined ? item.ingredientId : dto.ingredientId;
        if (nextIngredientId) {
          const ingredient = await manager.getRepository(Ingredient).findOneBy({
            id: nextIngredientId,
            householdId: user.householdId,
          });
          if (!ingredient) throw new NotFoundException('关联食材不存在');
          const duplicate = await items.findOneBy({
            householdId: user.householdId,
            ingredientId: nextIngredientId,
            unit: nextUnit,
          });
          if (duplicate && duplicate.id !== id) {
            throw new ConflictException('这个食材和单位已经关联了库存');
          }
        }
        if (dto.ingredientId !== undefined) {
          item.ingredientId = dto.ingredientId;
        }
        if (dto.category != null) item.category = dto.category;
        if (dto.unit != null) item.unit = nextUnit;
        if (dto.lowStockThreshold != null) {
          item.lowStockThreshold = String(dto.lowStockThreshold);
        }
        if (dto.restockQuantity != null) {
          item.restockQuantity = String(dto.restockQuantity);
        }
        if (quantityChanged) item.quantity = String(quantityAfter);
        await items.save(item);

        if (quantityChanged) {
          const transaction = this.ledger.createTransaction(manager, {
              householdId: user.householdId,
              inventoryItemId: item.id,
              operationId: randomUUID(),
              type: 'adjustment',
              quantityBefore,
              delta: quantityAfter - quantityBefore,
              quantityAfter,
              unit: item.unit,
              actor: user,
              sourceType: 'manual_adjustment',
              sourceId: item.id,
              idempotencyKey: `manual-adjustment:${adjustmentKey!}`,
            });
          transaction.id = randomUUID();
          await manager.getRepository(InventoryTransaction).save(transaction);
          if (quantityAfter < quantityBefore) {
            await this.batchService.applyConsumption(manager, {
              item,
              quantity: quantityBefore - quantityAfter,
              transaction,
              actor: user,
              sourceType: 'manual_adjustment',
              sourceId: item.id,
              movementType: 'adjustment',
            });
          }
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('同名库存或食材单位关联已经存在');
      }
      throw error;
    }
    return this.reload(id, user.householdId);
  }

  private async reload(id: string, householdId: string) {
    const saved = await this.items.findOneBy({ id, householdId });
    if (!saved) throw new NotFoundException('库存项不存在');
    return saved;
  }

  async remove(id: string, householdId: string) {
    if (
      await this.dataSource
        .getRepository(MaintenanceConsumable)
        .existsBy({ inventoryItemId: id, householdId })
    ) {
      throw new ConflictException('这个库存项仍被资产维护耗材引用');
    }
    if (
      await this.dataSource
        .getRepository(ShoppingItem)
        .existsBy({ inventoryItemId: id, householdId })
    ) {
      throw new ConflictException('这个库存项仍被购物清单引用');
    }
    if (await this.transactions.existsBy({ inventoryItemId: id, householdId })) {
      throw new ConflictException('已有库存流水的库存项不能删除');
    }
    if (await this.batches.existsBy({ inventoryItemId: id, householdId })) {
      throw new ConflictException('已有食品批次的库存项不能删除');
    }
    const result = await this.items.delete({ id, householdId });
    if (!result.affected) throw new NotFoundException('库存项不存在');
    return { id, removed: true };
  }
}
