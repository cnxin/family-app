import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { InventoryItem, InventoryTransaction, ShoppingItem } from '../entities';
import {
  BatchDatesInput,
  InventoryBatchesService,
} from './inventory-batches.service';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';
import {
  MAX_QUANTITY,
  roundQuantity,
  quantityString,
  assertQuantityRange,
} from './inventory-quantity';
import { InventoryTransactionsService } from './inventory-transactions.service';

function resolveShoppingInventory(
  shoppingItem: ShoppingItem,
  inventory: InventoryItem[],
  inventoryItemId: string | undefined,
  strict: boolean,
) {
  let target: InventoryItem | undefined;
  if (shoppingItem.inventoryItemId) {
    if (
      inventoryItemId &&
      inventoryItemId !== shoppingItem.inventoryItemId &&
      strict
    ) {
      throw new ConflictException('这个维护购物项已经关联了指定库存项');
    }
    target = inventory.find(
      (item) => item.id === shoppingItem.inventoryItemId,
    );
    if (!target && strict) throw new NotFoundException('关联库存项不存在');
  } else if (inventoryItemId) {
    target = inventory.find((item) => item.id === inventoryItemId);
    if (!target && strict) throw new NotFoundException('所选库存项不存在');
  } else if (shoppingItem.ingredientId && shoppingItem.unit) {
    target = inventory.find(
      (item) =>
        item.ingredientId === shoppingItem.ingredientId &&
        item.unit === shoppingItem.unit,
    );
  }
  if (!target) return null;
  if (target.unit !== shoppingItem.unit) {
    if (strict) throw new ConflictException('购物项和库存项的单位不一致');
    return null;
  }
  if (
    shoppingItem.ingredientId &&
    target.ingredientId !== shoppingItem.ingredientId
  ) {
    if (strict) throw new ConflictException('购物项和库存项关联的食材不一致');
    return null;
  }
  return target;
}

/** 买到后入库（POST /shopping-items/:id/confirm-stock，归库存插件，§8.6 第 4 条）：预览与确认（J7.2 从 InventoryTransactionsService 拆出）。 */
@Injectable()
export class InventoryShoppingReceiptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly facades: PluginFacadeRegistry,
    private readonly batches: InventoryBatchesService,
    private readonly ledger: InventoryTransactionsService,
  ) {}

  async shoppingPreview(
    shoppingItemId: string,
    householdId: string,
    inventoryItemId?: string,
  ) {
    const shoppingItem = await this.dataSource
      .getRepository(ShoppingItem)
      .findOneBy({ id: shoppingItemId, householdId });
    if (!shoppingItem) throw new NotFoundException('清单项不存在');
    const inventory = await this.dataSource.getRepository(InventoryItem).find({
      where: { householdId },
      order: { name: 'ASC' },
    });
    const existing = await this.ledger.sourceTransactions(
      householdId,
      'shopping_item',
      shoppingItem.id,
      'receipt',
    );
    const confirmation = existing[0]
      ? await this.ledger.transactionConfirmation(existing[0], householdId)
      : null;
    const selected = resolveShoppingInventory(
      shoppingItem,
      inventory,
      inventoryItemId,
      false,
    );
    const quantity = Number(shoppingItem.totalQty);
    const quantityBefore = selected ? Number(selected.quantity) : null;
    const quantityAfter =
      selected && Number.isFinite(quantity)
        ? roundQuantity(Number(selected.quantity) + quantity)
        : null;
    const candidates = inventory
      .filter((item) =>
        shoppingItem.inventoryItemId
          ? item.id === shoppingItem.inventoryItemId
          : shoppingItem.ingredientId
            ? item.ingredientId === shoppingItem.ingredientId
            : item.unit === shoppingItem.unit,
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
      }));
    return {
      shoppingItem: {
        id: shoppingItem.id,
        name: shoppingItem.ingredient?.name ?? shoppingItem.customName ?? '未知物品',
        ingredientId: shoppingItem.ingredientId,
        quantity: shoppingItem.totalQty,
        unit: shoppingItem.unit,
        checked: shoppingItem.checked,
      },
      candidates,
      selectedInventoryItem: selected
        ? {
            id: selected.id,
            name: selected.name,
            ingredientId: selected.ingredientId,
            quantity: selected.quantity,
            unit: selected.unit,
          }
        : null,
      quantityBefore,
      quantityAfter,
      canConfirm:
        !confirmation &&
        shoppingItem.checked &&
        Boolean(selected) &&
        Number.isFinite(quantity) &&
        quantity > 0 &&
        quantityAfter != null &&
        quantityAfter <= MAX_QUANTITY,
      confirmation,
    };
  }

  async confirmShoppingReceipt(
    shoppingItemId: string,
    inventoryItemId: string | undefined,
    batchDates: BatchDatesInput | undefined,
    user: JwtUser,
    locationId?: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-shopping:${user.householdId}:${shoppingItemId}`,
      ]);
      const existing = await this.ledger.sourceTransactions(
        user.householdId,
        'shopping_item',
        shoppingItemId,
        'receipt',
        manager,
      );
      if (existing.length) {
        return {
          alreadyConfirmed: true,
          transactions: existing,
        };
      }
      const shoppingItem = await manager
        .getRepository(ShoppingItem)
        .createQueryBuilder('shoppingItem')
        .where('shoppingItem.id = :id', { id: shoppingItemId })
        .andWhere('shoppingItem.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!shoppingItem) throw new NotFoundException('清单项不存在');
      if (!shoppingItem.checked) {
        throw new ConflictException('请先确认这个购物项已经买到');
      }
      const quantity = Number(shoppingItem.totalQty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('清单项没有可入库的有效数量');
      }
      const inventory = await manager
        .getRepository(InventoryItem)
        .createQueryBuilder('item')
        .where('item.householdId = :householdId', {
          householdId: user.householdId,
        })
        .orderBy('item.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const target = resolveShoppingInventory(
        shoppingItem,
        inventory,
        inventoryItemId,
        true,
      );
      if (!target) {
        throw new BadRequestException('需要先选择对应的库存项');
      }
      const quantityBefore = Number(target.quantity);
      const quantityAfter = roundQuantity(quantityBefore + quantity);
      assertQuantityRange(quantityAfter);
      target.quantity = quantityString(quantityAfter);
      // I1「放哪儿」：分批时记在新批次上（物品还没有默认位置就顺手记上）；不分批时就是物品的默认位置
      const location = (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), user.householdId, locationId)) ?? null;
      if (location && (!batchDates || !target.defaultLocationId)) target.defaultLocationId = location;
      await manager.getRepository(InventoryItem).save(target);
      const transaction = this.ledger.createTransaction(manager, {
        householdId: user.householdId,
        inventoryItemId: target.id,
        operationId: randomUUID(),
        type: 'receipt',
        quantityBefore,
        delta: quantity,
        quantityAfter,
        unit: target.unit,
        actor: user,
        sourceType: 'shopping_item',
        sourceId: shoppingItem.id,
        idempotencyKey: `shopping-item:${shoppingItem.id}:receipt`,
      });
      transaction.id = randomUUID();
      const saved = await manager.getRepository(InventoryTransaction).save(transaction);
      if (batchDates) {
        await this.batches.createReceiptBatch(manager, {
          item: target,
          quantity,
          transaction: saved,
          actor: user,
          sourceId: shoppingItem.id,
          dates: batchDates,
          locationId: location,
        });
      }
      return { alreadyConfirmed: false, transactions: [saved] };
    });
  }
}
