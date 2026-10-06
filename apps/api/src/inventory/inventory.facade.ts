import type { InventoryFacade, PluginTransaction } from '@family/contracts';
import { DataSource, In } from 'typeorm';
import type { JwtUser } from '../auth/jwt.guard';
import { InventoryItem, InventoryTransaction } from '../entities';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { InventoryTransactionsService } from './inventory-transactions.service';

/**
 * 库存门面的实现（J1b，接口见 contracts/plugins/inventory.facade.ts），InventoryModule 启动时注册。
 * 维护出库沿用 InventoryTransactionsService 原来给资产调的 createTransaction / applyBatchConsumption，写法与搬家前逐行一致。
 */
export function inventoryFacade(ledger: InventoryTransactionsService, dataSource: DataSource): InventoryFacade {
  const managerOf = (transaction?: PluginTransaction) =>
    transaction ? fromPluginTransaction(transaction) : dataSource.manager;
  return {
    async consumeForMaintenance(transaction, input) {
      const manager = fromPluginTransaction(transaction);
      const actor = input.actor as JwtUser;
      for (const line of input.lines) {
        const pending = ledger.createTransaction(manager, {
          householdId: input.householdId,
          inventoryItemId: line.inventoryItemId,
          operationId: input.operationId,
          type: 'consumption',
          quantityBefore: line.quantityBefore,
          delta: -line.quantity,
          quantityAfter: line.quantityAfter,
          unit: line.unit,
          actor,
          sourceType: 'maintenance_record',
          sourceId: input.recordId,
          idempotencyKey: `maintenance-record:${input.recordId}:consumption:${line.inventoryItemId}`,
        });
        pending.id = line.transactionId;
        // 资产那边已在同一事务里锁住这一行；不带 eager 关系重读，和原来保存的那份对象一样
        const item = await manager
          .getRepository(InventoryItem)
          .createQueryBuilder('item')
          .where('item.id = :id AND item.householdId = :householdId', {
            id: line.inventoryItemId,
            householdId: input.householdId,
          })
          .getOneOrFail();
        item.quantity = pending.quantityAfter;
        await manager.getRepository(InventoryItem).save(item);
        const saved = await manager.getRepository(InventoryTransaction).save(pending);
        await ledger.applyBatchConsumption(manager, {
          item,
          quantity: -Number(saved.delta),
          transaction: saved,
          actor,
          sourceType: 'maintenance_record',
          sourceId: input.recordId,
        });
      }
    },

    async listIngredientStock(transaction, householdId, ingredientIds) {
      const rows = await fromPluginTransaction(transaction)
        .getRepository(InventoryItem)
        .find({ where: { householdId, ingredientId: In(ingredientIds) } });
      return rows.map((item) => ({ ingredientId: item.ingredientId, unit: item.unit, quantity: item.quantity }));
    },

    async listShoppingReceipts(householdId, shoppingItemIds, transaction) {
      if (!shoppingItemIds.length) return [];
      const repository = managerOf(transaction).getRepository(InventoryTransaction);
      const receipts = await repository.find({
        where: {
          householdId,
          sourceType: 'shopping_item',
          sourceId: In(shoppingItemIds),
          type: 'receipt',
        },
        order: { createdAt: 'ASC' },
      });
      const reversals = receipts.length
        ? await repository.find({
            where: {
              householdId,
              reversesTransactionId: In(receipts.map((row) => row.id)),
            },
          })
        : [];
      const reversalByOriginal = new Map(reversals.map((row) => [row.reversesTransactionId, row]));
      return receipts.map((receipt) => ({
        transactionId: receipt.id,
        shoppingItemId: receipt.sourceId,
        inventoryItemId: receipt.inventoryItemId,
        inventoryItemName: receipt.inventoryItem.name,
        quantityBefore: receipt.quantityBefore,
        delta: receipt.delta,
        quantityAfter: receipt.quantityAfter,
        unit: receipt.unit,
        actorName: receipt.actorName,
        createdAt: receipt.createdAt,
        reversedAt: reversalByOriginal.get(receipt.id)?.createdAt ?? null,
      }));
    },

    hasShoppingReceipt: (householdId, shoppingItemId) =>
      dataSource.manager.getRepository(InventoryTransaction).existsBy({
        householdId,
        sourceType: 'shopping_item',
        sourceId: shoppingItemId,
        type: 'receipt',
      }),
  };
}
