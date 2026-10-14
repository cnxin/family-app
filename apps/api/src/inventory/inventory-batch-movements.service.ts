import { Clock } from '../common/clock';
import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  InventoryBatch,
  InventoryBatchMovement,
  InventoryBatchMovementType,
  InventoryItem,
  InventoryTransaction,
} from '../entities';
import { roundQuantity, quantityString } from './inventory-quantity';
import {
  BatchDatesInput,
  ConsumptionSource,
  normalizeDates,
  fifoSort,
  presentAllocation,
  createMovement,
} from './inventory-batches.rules';
import { InventoryBatchesService } from './inventory-batches.service';

/** 批次出入库：买到入库建批次、按先进先出分配、扣减与撤销（J7.2 从 InventoryBatchesService 拆出，只给库存流水、入库、用料三个服务调）。 */
@Injectable()
export class InventoryBatchMovementsService {
  constructor(
    private readonly clock: Clock,
    private readonly batchService: InventoryBatchesService,
  ) {}

  async createReceiptBatch(
    manager: EntityManager,
    input: {
      item: InventoryItem;
      quantity: number;
      transaction: InventoryTransaction;
      actor: JwtUser;
      sourceId: string;
      dates: BatchDatesInput;
      /** 已校验过的位置；null 时取物品的默认位置 */
      locationId: string | null;
    },
  ) {
    const existing = await manager.getRepository(InventoryBatch).findOneBy({
      householdId: input.actor.householdId,
      sourceType: 'shopping_item',
      sourceId: input.sourceId,
    });
    if (existing) return existing;
    const dates = normalizeDates(input.dates, await this.batchService.today(input.actor.householdId));
    const batch = await manager.getRepository(InventoryBatch).save(
      manager.getRepository(InventoryBatch).create({
        householdId: input.actor.householdId,
        inventoryItemId: input.item.id,
        quantity: quantityString(input.quantity),
        locationId: input.locationId ?? input.item.defaultLocationId ?? null,
        locationUpdatedAt: (input.locationId ?? input.item.defaultLocationId) ? this.clock.now() : null,
        ...dates,
        sourceType: 'shopping_item',
        sourceId: input.sourceId,
        version: 1,
        createdById: input.actor.memberId,
      }),
    );
    await manager.getRepository(InventoryBatchMovement).save(
      createMovement(manager, {
        householdId: input.actor.householdId,
        batchId: batch.id,
        inventoryTransactionId: input.transaction.id,
        operationId: input.transaction.operationId,
        type: 'receipt',
        quantityBefore: 0,
        delta: input.quantity,
        quantityAfter: input.quantity,
        actor: input.actor,
        sourceType: 'shopping_item',
        sourceId: input.sourceId,
        idempotencyKey: `shopping-item:${input.sourceId}:batch-receipt`,
      }),
    );
    return batch;
  }

  async availableBatches(
    manager: EntityManager,
    householdId: string,
    itemIds: string[],
    lock = false,
  ) {
    if (!itemIds.length) return [];
    const query = manager
      .getRepository(InventoryBatch)
      .createQueryBuilder('batch')
      .where('batch.householdId = :householdId', { householdId })
      .andWhere('batch.inventoryItemId IN (:...itemIds)', { itemIds })
      .andWhere('batch.quantity > 0')
      .orderBy('batch.inventoryItemId', 'ASC')
      .addOrderBy('batch.expiresOn', 'ASC', 'NULLS LAST')
      .addOrderBy('batch.productionDate', 'ASC', 'NULLS LAST')
      .addOrderBy('batch.receivedOn', 'ASC')
      .addOrderBy('batch.createdAt', 'ASC')
      .addOrderBy('batch.id', 'ASC');
    if (lock) query.setLock('pessimistic_write');
    return query.getMany();
  }

  previewAllocations(
    batches: InventoryBatch[],
    inventoryItemId: string,
    quantity: number,
  ) {
    let remaining = roundQuantity(quantity);
    const allocations: ReturnType<typeof presentAllocation>[] = [];
    for (const batch of batches
      .filter(
        (candidate) =>
          candidate.inventoryItemId === inventoryItemId &&
          Number(candidate.quantity) > 0,
      )
      .sort(fifoSort)) {
      if (remaining <= 0) break;
      const quantityBefore = Number(batch.quantity);
      const consumed = Math.min(quantityBefore, remaining);
      const quantityAfter = roundQuantity(quantityBefore - consumed);
      allocations.push(
        presentAllocation(batch, quantityBefore, consumed, quantityAfter),
      );
      remaining = roundQuantity(remaining - consumed);
    }
    return {
      allocations,
      untrackedQuantity: Math.max(0, remaining),
    };
  }

  async applyConsumption(
    manager: EntityManager,
    input: {
      item: InventoryItem;
      quantity: number;
      transaction: InventoryTransaction;
      actor: JwtUser;
      sourceType: ConsumptionSource;
      sourceId: string;
      movementType?: Extract<InventoryBatchMovementType, 'consumption' | 'adjustment'>;
    },
  ) {
    const batches = await this.availableBatches(
      manager,
      input.actor.householdId,
      [input.item.id],
      true,
    );
    const preview = this.previewAllocations(
      batches,
      input.item.id,
      input.quantity,
    );
    for (const allocation of preview.allocations) {
      const batch = batches.find((candidate) => candidate.id === allocation.batchId);
      if (!batch || Number(batch.quantity) !== allocation.quantityBefore) {
        throw new ConflictException('库存批次已经变化，请刷新后重试');
      }
      batch.quantity = quantityString(allocation.quantityAfter);
      batch.version += 1;
      await manager.getRepository(InventoryBatch).save(batch);
      await manager.getRepository(InventoryBatchMovement).save(
        createMovement(manager, {
          householdId: input.actor.householdId,
          batchId: batch.id,
          inventoryTransactionId: input.transaction.id,
          operationId: input.transaction.operationId,
          type: input.movementType ?? 'consumption',
          quantityBefore: allocation.quantityBefore,
          delta: -allocation.quantity,
          quantityAfter: allocation.quantityAfter,
          actor: input.actor,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey: `${input.transaction.id}:batch:${batch.id}`,
        }),
      );
    }
    return preview;
  }

  async reverseMovements(
    manager: EntityManager,
    input: {
      originals: InventoryTransaction[];
      reversals: InventoryTransaction[];
      actor: JwtUser;
    },
  ) {
    const originalIds = input.originals.map((row) => row.id);
    const movements = originalIds.length
      ? await manager.getRepository(InventoryBatchMovement).find({
          where: {
            householdId: input.actor.householdId,
            inventoryTransactionId: In(originalIds),
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    if (!movements.length) return new Set<string>();
    const batches = await manager
      .getRepository(InventoryBatch)
      .createQueryBuilder('batch')
      .where('batch.householdId = :householdId', {
        householdId: input.actor.householdId,
      })
      .andWhere('batch.id IN (:...batchIds)', {
        batchIds: [...new Set(movements.map((row) => row.batchId))],
      })
      .orderBy('batch.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    for (const movement of [...movements].reverse()) {
      const batch = batches.find((candidate) => candidate.id === movement.batchId);
      if (!batch || Number(batch.quantity) !== Number(movement.quantityAfter)) {
        throw new ConflictException('库存批次已经变化，不能撤销这次操作');
      }
      const reversal = input.reversals.find(
        (row) => row.reversesTransactionId === movement.inventoryTransactionId,
      );
      if (!reversal) throw new ConflictException('库存批次撤销缺少对应流水');
      const quantityBefore = Number(batch.quantity);
      const quantityAfter = Number(movement.quantityBefore);
      batch.quantity = quantityString(quantityAfter);
      batch.version += 1;
      await manager.getRepository(InventoryBatch).save(batch);
      await manager.getRepository(InventoryBatchMovement).save(
        createMovement(manager, {
          householdId: input.actor.householdId,
          batchId: batch.id,
          inventoryTransactionId: reversal.id,
          operationId: reversal.operationId,
          type: 'reversal',
          quantityBefore,
          delta: quantityAfter - quantityBefore,
          quantityAfter,
          actor: input.actor,
          sourceType: 'inventory_transaction',
          sourceId: movement.id,
          idempotencyKey: `inventory-batch-movement:${movement.id}:reversal`,
          reversesMovementId: movement.id,
        }),
      );
    }
    return new Set(
      movements
        .map((movement) => movement.inventoryTransactionId)
        .filter((id): id is string => Boolean(id)),
    );
  }
}
