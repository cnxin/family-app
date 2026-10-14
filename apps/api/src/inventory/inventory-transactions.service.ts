import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { InventoryItem, InventoryTransaction } from '../entities';
import { InventoryBatchMovementsService } from './inventory-batch-movements.service';
import { roundQuantity, quantityString, assertQuantityRange } from './inventory-quantity';

@Injectable()
export class InventoryTransactionsService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly transactions: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
    private readonly batches: InventoryBatchMovementsService,
  ) {}

  createTransaction(
    manager: EntityManager,
    input: {
      householdId: string;
      inventoryItemId: string;
      operationId: string;
      type: 'receipt' | 'consumption' | 'adjustment' | 'reversal';
      quantityBefore: number;
      delta: number;
      quantityAfter: number;
      unit: string;
      actor: JwtUser;
      sourceType:
        | 'shopping_item'
        | 'menu'
        | 'maintenance_record'
        | 'inventory_item'
        | 'manual_adjustment'
        | 'inventory_transaction';
      sourceId: string;
      idempotencyKey: string;
      reversesTransactionId?: string | null;
    },
  ) {
    assertQuantityRange(input.quantityBefore);
    assertQuantityRange(input.quantityAfter);
    const delta = roundQuantity(input.delta);
    if (!delta) throw new BadRequestException('库存变化量不能为 0');
    return manager.getRepository(InventoryTransaction).create({
      householdId: input.householdId,
      inventoryItemId: input.inventoryItemId,
      operationId: input.operationId,
      type: input.type,
      quantityBefore: quantityString(input.quantityBefore),
      delta: quantityString(delta),
      quantityAfter: quantityString(input.quantityAfter),
      unit: input.unit,
      actorId: input.actor.memberId,
      actorName: input.actor.name,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      reversesTransactionId: input.reversesTransactionId ?? null,
    });
  }

  async list(
    householdId: string,
    inventoryItemId?: string,
    requestedLimit = 50,
  ) {
    if (inventoryItemId) {
      const itemExists = await this.dataSource
        .getRepository(InventoryItem)
        .existsBy({ id: inventoryItemId, householdId });
      if (!itemExists) throw new NotFoundException('库存项不存在');
    }
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const rows = await this.transactions.find({
      where: {
        householdId,
        ...(inventoryItemId ? { inventoryItemId } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    if (!rows.length) return [];

    const operationIds = [...new Set(rows.map((row) => row.operationId))];
    const operationRows = await this.transactions.find({
      where: { householdId, operationId: In(operationIds) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const originalRows = operationRows.filter((row) => row.type !== 'reversal');
    const originalIds = originalRows.map((row) => row.id);
    const reversals = originalIds.length
      ? await this.transactions.find({
          where: { householdId, reversesTransactionId: In(originalIds) },
        })
      : [];
    const reversalByOriginal = new Map(
      reversals.map((row) => [row.reversesTransactionId, row]),
    );
    const itemIds = [
      ...new Set(originalRows.map((row) => row.inventoryItemId)),
    ];
    const latestByItem = new Map<string, string>();
    await Promise.all(
      itemIds.map(async (id) => {
        const latest = await this.transactions.findOne({
          where: { householdId, inventoryItemId: id },
          order: { createdAt: 'DESC', id: 'DESC' },
        });
        if (latest) latestByItem.set(id, latest.id);
      }),
    );
    const rowsByOperation = new Map<string, InventoryTransaction[]>();
    for (const row of originalRows) {
      rowsByOperation.set(row.operationId, [
        ...(rowsByOperation.get(row.operationId) ?? []),
        row,
      ]);
    }
    const reversibleOperation = new Map<string, boolean>();
    for (const [operationId, group] of rowsByOperation) {
      reversibleOperation.set(
        operationId,
        group.every(
          (row) =>
            (row.type === 'receipt' || row.type === 'consumption') &&
            !reversalByOriginal.has(row.id) &&
            latestByItem.get(row.inventoryItemId) === row.id,
        ),
      );
    }

    return rows.map((row) => {
      const reversal = reversalByOriginal.get(row.id);
      return {
        ...row,
        reversedAt: reversal?.createdAt ?? null,
        reversalTransactionId: reversal?.id ?? null,
        canReverse:
          row.type !== 'reversal' &&
          (reversibleOperation.get(row.operationId) ?? false),
      };
    });
  }

  applyBatchConsumption(
    manager: EntityManager,
    input: {
      item: InventoryItem;
      quantity: number;
      transaction: InventoryTransaction;
      actor: JwtUser;
      sourceType: 'maintenance_record';
      sourceId: string;
    },
  ) {
    return this.batches.applyConsumption(manager, input);
  }

  async reverse(transactionId: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-reversal:${user.householdId}:${transactionId}`,
      ]);
      const repository = manager.getRepository(InventoryTransaction);
      const target = await repository.findOneBy({
        id: transactionId,
        householdId: user.householdId,
      });
      if (!target) throw new NotFoundException('库存流水不存在');
      if (target.type !== 'receipt' && target.type !== 'consumption') {
        throw new ConflictException('只能撤销最近的入库或扣库流水');
      }
      const originals = await repository.find({
        where: {
          householdId: user.householdId,
          operationId: target.operationId,
          type: target.type,
        },
        order: { inventoryItemId: 'ASC' },
      });
      const reversals = await repository.find({
        where: {
          householdId: user.householdId,
          reversesTransactionId: In(originals.map((row) => row.id)),
        },
      });
      if (reversals.length) {
        if (reversals.length === originals.length) {
          return { alreadyReversed: true, transactions: reversals };
        }
        throw new ConflictException('这组库存流水只撤销了一部分，请检查数据');
      }

      const itemIds = originals.map((row) => row.inventoryItemId).sort();
      const items = await manager
        .getRepository(InventoryItem)
        .createQueryBuilder('item')
        .where('item.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('item.id IN (:...itemIds)', { itemIds })
        .orderBy('item.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      if (items.length !== itemIds.length) {
        throw new NotFoundException('相关库存项不存在');
      }
      for (const original of originals) {
        const latest = await repository.findOne({
          where: {
            householdId: user.householdId,
            inventoryItemId: original.inventoryItemId,
          },
          order: { createdAt: 'DESC', id: 'DESC' },
        });
        if (latest?.id !== original.id) {
          throw new ConflictException('只能撤销仍是最近变动的入库或扣库');
        }
      }

      const operationId = randomUUID();
      const saved: InventoryTransaction[] = [];
      for (const original of originals) {
        const item = items.find((candidate) => candidate.id === original.inventoryItemId);
        if (!item || Number(item.quantity) !== Number(original.quantityAfter)) {
          throw new ConflictException('库存数量已经变化，不能撤销这次操作');
        }
        const quantityBefore = Number(item.quantity);
        const delta = -Number(original.delta);
        const quantityAfter = roundQuantity(quantityBefore + delta);
        assertQuantityRange(quantityAfter);
        item.quantity = quantityString(quantityAfter);
        await manager.getRepository(InventoryItem).save(item);
        saved.push(
          await repository.save(
            this.createTransaction(manager, {
              householdId: user.householdId,
              inventoryItemId: item.id,
              operationId,
              type: 'reversal',
              quantityBefore,
              delta,
              quantityAfter,
              unit: original.unit,
              actor: user,
              sourceType: 'inventory_transaction',
              sourceId: original.id,
              idempotencyKey: `inventory-transaction:${original.id}:reversal`,
              reversesTransactionId: original.id,
            }),
          ),
        );
      }
      const movementTransactionIds = await this.batches.reverseMovements(manager, {
        originals,
        reversals: saved,
        actor: user,
      });
      for (const reversal of saved) {
        const original = originals.find(
          (candidate) => candidate.id === reversal.reversesTransactionId,
        );
        if (
          !original ||
          Number(reversal.delta) >= 0 ||
          movementTransactionIds.has(original.id)
        ) {
          continue;
        }
        const item = items.find(
          (candidate) => candidate.id === reversal.inventoryItemId,
        );
        if (!item) throw new NotFoundException('相关库存项不存在');
        await this.batches.applyConsumption(manager, {
          item,
          quantity: -Number(reversal.delta),
          transaction: reversal,
          actor: user,
          sourceType: 'inventory_transaction',
          sourceId: original.id,
          movementType: 'adjustment',
        });
      }
      return { alreadyReversed: false, transactions: saved };
    });
  }

  async sourceTransactions(
    householdId: string,
    sourceType: 'shopping_item' | 'menu',
    sourceId: string,
    type: 'receipt' | 'consumption',
    manager?: EntityManager,
  ) {
    return (manager?.getRepository(InventoryTransaction) ?? this.transactions).find({
      where: { householdId, sourceType, sourceId, type },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async transactionConfirmation(
    transaction: InventoryTransaction,
    householdId: string,
  ) {
    const reversal = await this.transactions.findOneBy({
      householdId,
      reversesTransactionId: transaction.id,
    });
    return {
      id: transaction.id,
      operationId: transaction.operationId,
      inventoryItemId: transaction.inventoryItemId,
      inventoryItemName: transaction.inventoryItem.name,
      quantityBefore: transaction.quantityBefore,
      delta: transaction.delta,
      quantityAfter: transaction.quantityAfter,
      unit: transaction.unit,
      actorName: transaction.actorName,
      createdAt: transaction.createdAt,
      reversedAt: reversal?.createdAt ?? null,
      reversalTransactionId: reversal?.id ?? null,
    };
  }
}
