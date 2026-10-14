import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { InventoryItem, InventoryBatch, InventoryTransaction, Menu, MenuItem } from '../entities';
import { InventoryBatchesService } from './inventory-batches.service';
import { roundQuantity, quantityString } from './inventory-quantity';
import { InventoryTransactionsService } from './inventory-transactions.service';

type MenuRequirement = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
};

type MenuInventoryPreviewRow = MenuRequirement & {
  status: 'ready' | 'missing_inventory' | 'unit_mismatch' | 'insufficient';
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  availableUnits: string[];
  batchAllocations: ReturnType<
    InventoryBatchesService['previewAllocations']
  >['allocations'];
  untrackedQuantity: number;
};

async function loadMenu(
  manager: EntityManager,
  menuId: string,
  householdId: string,
  lock = false,
) {
  const menu = lock
    ? await manager
        .getRepository(Menu)
        .createQueryBuilder('menu')
        .where('menu.id = :menuId', { menuId })
        .andWhere('menu.householdId = :householdId', { householdId })
        .setLock('pessimistic_write')
        .getOne()
    : await manager.getRepository(Menu).findOneBy({ id: menuId, householdId });
  if (!menu) throw new NotFoundException('菜单不存在');
  menu.items = await manager.getRepository(MenuItem).find({
    where: { menuId: menu.id },
    relations: { dish: { ingredients: { ingredient: true } } },
    order: { createdAt: 'ASC' },
  });
  return menu;
}

function menuRequirements(menu: Menu) {
  const merged = new Map<string, MenuRequirement>();
  for (const item of menu.items.filter((candidate) => candidate.status === 'done')) {
    const ingredients = item.recipeSnapshot
      ? item.recipeSnapshot.ingredients
      : (item.dish.ingredients ?? []).map((dishIngredient) => ({
          ingredientId: dishIngredient.ingredientId,
          name: dishIngredient.ingredient.name,
          quantity: Number(dishIngredient.quantity),
          unit: dishIngredient.unit,
        }));
    for (const ingredient of ingredients) {
      const key = `${ingredient.ingredientId}|${ingredient.unit}`;
      const previous = merged.get(key);
      merged.set(key, {
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        quantity: roundQuantity(
          (previous?.quantity ?? 0) + Number(ingredient.quantity),
        ),
      });
    }
  }
  return [...merged.values()];
}

/** 确认用料（POST /menus/:id/confirm-consumption，归库存插件）：按菜单算用料、预览与扣库存（J7.2 从 InventoryTransactionsService 拆出）。 */
@Injectable()
export class InventoryMenuConsumptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly batches: InventoryBatchesService,
    private readonly ledger: InventoryTransactionsService,
  ) {}

  async menuPreview(menuId: string, householdId: string) {
    const menu = await loadMenu(this.dataSource.manager, menuId, householdId);
    const existing = await this.ledger.sourceTransactions(
      householdId,
      'menu',
      menu.id,
      'consumption',
    );
    const confirmations = await Promise.all(
      existing.map((row) => this.ledger.transactionConfirmation(row, householdId)),
    );
    const inventory = await this.dataSource.getRepository(InventoryItem).find({
      where: { householdId },
      order: { id: 'ASC' },
    });
    const batches = await this.batches.availableBatches(
      this.dataSource.manager,
      householdId,
      inventory.map((item) => item.id),
    );
    const rows = this.menuPreviewRows(menu, inventory, batches);
    const blocking = rows.filter(
      (row) => row.status === 'insufficient' || row.status === 'unit_mismatch',
    );
    return {
      menuId: menu.id,
      menuStatus: menu.status,
      confirmed: existing.length > 0,
      reversed:
        confirmations.length > 0 &&
        confirmations.every((confirmation) => confirmation.reversedAt != null),
      transactions: confirmations,
      rows,
      canConfirm:
        menu.status === 'done' &&
        existing.length === 0 &&
        blocking.length === 0 &&
        rows.some((row) => row.status === 'ready'),
    };
  }

  async confirmMenuConsumption(menuId: string, user: JwtUser) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-menu:${user.householdId}:${menuId}`,
      ]);
      const existing = await this.ledger.sourceTransactions(
        user.householdId,
        'menu',
        menuId,
        'consumption',
        manager,
      );
      if (existing.length) {
        return { alreadyConfirmed: true, transactions: existing };
      }
      const menu = await loadMenu(manager, menuId, user.householdId, true);
      if (menu.status !== 'done') {
        throw new ConflictException('需要先结束本餐，再确认扣减库存');
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
      const batches = await this.batches.availableBatches(
        manager,
        user.householdId,
        inventory.map((item) => item.id),
        true,
      );
      const rows = this.menuPreviewRows(menu, inventory, batches);
      const unitMismatch = rows.find((row) => row.status === 'unit_mismatch');
      if (unitMismatch) {
        throw new ConflictException(
          `「${unitMismatch.ingredientName}」库存单位不匹配，请先调整库存单位`,
        );
      }
      const insufficient = rows.find((row) => row.status === 'insufficient');
      if (insufficient) {
        throw new ConflictException(
          `「${insufficient.inventoryItemName}」库存不足，需要 ${insufficient.quantity} ${insufficient.unit}`,
        );
      }
      const ready = rows.filter(
        (row): row is MenuInventoryPreviewRow & { inventoryItemId: string } =>
          row.status === 'ready' && row.inventoryItemId != null,
      );
      if (!ready.length) {
        throw new ConflictException('本餐没有可匹配扣减的库存项');
      }
      const operationId = randomUUID();
      const transactionRepository = manager.getRepository(InventoryTransaction);
      const saved: InventoryTransaction[] = [];
      for (const row of ready) {
        const item = inventory.find((candidate) => candidate.id === row.inventoryItemId);
        if (!item || row.quantityBefore == null || row.quantityAfter == null) {
          throw new ConflictException('库存预览已经变化，请重试');
        }
        item.quantity = quantityString(row.quantityAfter);
        await manager.getRepository(InventoryItem).save(item);
        const transaction = this.ledger.createTransaction(manager, {
              householdId: user.householdId,
              inventoryItemId: item.id,
              operationId,
              type: 'consumption',
              quantityBefore: row.quantityBefore,
              delta: -row.quantity,
              quantityAfter: row.quantityAfter,
              unit: item.unit,
              actor: user,
              sourceType: 'menu',
              sourceId: menu.id,
              idempotencyKey: `menu:${menu.id}:consumption:${item.id}`,
            });
        transaction.id = randomUUID();
        const savedTransaction = await transactionRepository.save(transaction);
        await this.batches.applyConsumption(manager, {
          item,
          quantity: row.quantity,
          transaction: savedTransaction,
          actor: user,
          sourceType: 'menu',
          sourceId: menu.id,
        });
        saved.push(savedTransaction);
      }
      return { alreadyConfirmed: false, transactions: saved };
    });
  }

  private menuPreviewRows(
    menu: Menu,
    inventory: InventoryItem[],
    batches: InventoryBatch[],
  ) {
    return menuRequirements(menu).map<MenuInventoryPreviewRow>((requirement) => {
      const sameIngredient = inventory.filter(
        (item) => item.ingredientId === requirement.ingredientId,
      );
      const exact = sameIngredient.find((item) => item.unit === requirement.unit);
      if (!exact) {
        return {
          ...requirement,
          status: sameIngredient.length ? 'unit_mismatch' : 'missing_inventory',
          inventoryItemId: null,
          inventoryItemName: null,
          quantityBefore: null,
          quantityAfter: null,
          availableUnits: [...new Set(sameIngredient.map((item) => item.unit))],
          batchAllocations: [],
          untrackedQuantity: 0,
        };
      }
      const quantityBefore = Number(exact.quantity);
      const quantityAfter = roundQuantity(quantityBefore - requirement.quantity);
      const allocation = this.batches.previewAllocations(
        batches,
        exact.id,
        requirement.quantity,
      );
      return {
        ...requirement,
        status: quantityAfter < 0 ? 'insufficient' : 'ready',
        inventoryItemId: exact.id,
        inventoryItemName: exact.name,
        quantityBefore,
        quantityAfter,
        availableUnits: [exact.unit],
        batchAllocations: allocation.allocations,
        untrackedQuantity: allocation.untrackedQuantity,
      };
    });
  }
}
