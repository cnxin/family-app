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
import {
  InventoryItem,
  InventoryTransaction,
  Menu,
  MenuItem,
  ShoppingItem,
} from '../entities';

const MAX_QUANTITY = 99_999_999.99;

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

function quantityString(value: number) {
  return String(roundQuantity(value));
}

function assertQuantityRange(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
    throw new BadRequestException(`库存数量必须在 0 到 ${MAX_QUANTITY} 之间`);
  }
}

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
};

@Injectable()
export class InventoryTransactionsService {
  constructor(
    @InjectRepository(InventoryTransaction)
    private readonly transactions: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
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
    const existing = await this.sourceTransactions(
      householdId,
      'shopping_item',
      shoppingItem.id,
      'receipt',
    );
    const confirmation = existing[0]
      ? await this.transactionConfirmation(existing[0], householdId)
      : null;
    const selected = this.resolveShoppingInventory(
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
    user: JwtUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-shopping:${user.householdId}:${shoppingItemId}`,
      ]);
      const existing = await this.sourceTransactions(
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
      const target = this.resolveShoppingInventory(
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
      await manager.getRepository(InventoryItem).save(target);
      const transaction = this.createTransaction(manager, {
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
      const saved = await manager.getRepository(InventoryTransaction).save(transaction);
      return { alreadyConfirmed: false, transactions: [saved] };
    });
  }

  async menuPreview(menuId: string, householdId: string) {
    const menu = await this.loadMenu(this.dataSource.manager, menuId, householdId);
    const existing = await this.sourceTransactions(
      householdId,
      'menu',
      menu.id,
      'consumption',
    );
    const confirmations = await Promise.all(
      existing.map((row) => this.transactionConfirmation(row, householdId)),
    );
    const inventory = await this.dataSource.getRepository(InventoryItem).find({
      where: { householdId },
      order: { id: 'ASC' },
    });
    const rows = this.menuPreviewRows(menu, inventory);
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
      const existing = await this.sourceTransactions(
        user.householdId,
        'menu',
        menuId,
        'consumption',
        manager,
      );
      if (existing.length) {
        return { alreadyConfirmed: true, transactions: existing };
      }
      const menu = await this.loadMenu(manager, menuId, user.householdId, true);
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
      const rows = this.menuPreviewRows(menu, inventory);
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
        saved.push(
          await transactionRepository.save(
            this.createTransaction(manager, {
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
            }),
          ),
        );
      }
      return { alreadyConfirmed: false, transactions: saved };
    });
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
      return { alreadyReversed: false, transactions: saved };
    });
  }

  private async loadMenu(
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

  private menuRequirements(menu: Menu) {
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

  private menuPreviewRows(menu: Menu, inventory: InventoryItem[]) {
    return this.menuRequirements(menu).map<MenuInventoryPreviewRow>((requirement) => {
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
        };
      }
      const quantityBefore = Number(exact.quantity);
      const quantityAfter = roundQuantity(quantityBefore - requirement.quantity);
      return {
        ...requirement,
        status: quantityAfter < 0 ? 'insufficient' : 'ready',
        inventoryItemId: exact.id,
        inventoryItemName: exact.name,
        quantityBefore,
        quantityAfter,
        availableUnits: [exact.unit],
      };
    });
  }

  private resolveShoppingInventory(
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

  private async sourceTransactions(
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

  private async transactionConfirmation(
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
