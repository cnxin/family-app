import { Clock } from '../common/clock';
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
  Household,
  InventoryBatch,
  InventoryBatchMovement,
  InventoryBatchMovementSourceType,
  InventoryBatchMovementType,
  InventoryItem,
  InventoryTransaction,
} from '../entities';
import { addDays, diffDays, householdToday, todayInShanghai } from '@family/shared';

const MAX_QUANTITY = 99_999_999.99;

export interface BatchDatesInput {
  receivedOn?: string | null;
  productionDate?: string | null;
  expiresOn?: string | null;
  openedOn?: string | null;
}

export interface CreateInventoryBatchInput extends BatchDatesInput {
  inventoryItemId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface UpdateInventoryBatchInput extends BatchDatesInput {
  expectedVersion: number;
}

type ConsumptionSource = Extract<
  InventoryBatchMovementSourceType,
  'menu' | 'maintenance_record' | 'manual_adjustment' | 'inventory_transaction'
>;

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

function quantityString(value: number) {
  return String(roundQuantity(value));
}

function validDate(value: string | null | undefined, label: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label}必须使用 YYYY-MM-DD 格式`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label}无效`);
  }
  return value;
}

function normalizeDates(input: BatchDatesInput, today: string) {
  const dates = {
    receivedOn: validDate(input.receivedOn, '入库日期') ?? today,
    productionDate: validDate(input.productionDate, '生产日期'),
    expiresOn: validDate(input.expiresOn, '到期日期'),
    openedOn: validDate(input.openedOn, '开封日期'),
  };
  if (
    dates.productionDate &&
    dates.expiresOn &&
    dates.expiresOn < dates.productionDate
  ) {
    throw new BadRequestException('到期日期不能早于生产日期');
  }
  return dates;
}

function statusFor(batch: InventoryBatch, warningDays: number, current: string) {
  if (Number(batch.quantity) <= 0) return 'consumed' as const;
  if (!batch.expiresOn) return 'undated' as const;
  if (batch.expiresOn < current) return 'expired' as const;
  if (batch.expiresOn <= addDays(current, warningDays)) return 'expiring' as const;
  return 'fresh' as const;
}

function fifoSort(a: InventoryBatch, b: InventoryBatch) {
  const aExpiry = a.expiresOn ?? '9999-12-31';
  const bExpiry = b.expiresOn ?? '9999-12-31';
  return (
    aExpiry.localeCompare(bExpiry) ||
    (a.productionDate ?? '9999-12-31').localeCompare(
      b.productionDate ?? '9999-12-31',
    ) ||
    a.receivedOn.localeCompare(b.receivedOn) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

@Injectable()
export class InventoryBatchesService {
  constructor(
    @InjectRepository(InventoryBatch)
    private readonly batches: Repository<InventoryBatch>,
    @InjectRepository(InventoryBatchMovement)
    private readonly movements: Repository<InventoryBatchMovement>,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  private async today(householdId: string): Promise<string> {
    const timezone = (await this.dataSource.getRepository(Household).findOneByOrFail({ id: householdId })).timezone;
    return householdToday(timezone, this.clock.now());
  }

  async list(
    householdId: string,
    inventoryItemId?: string,
    status: 'all' | 'active' | 'expiring' | 'expired' = 'all',
    warningDays = 7,
  ) {
    if (inventoryItemId) {
      const exists = await this.dataSource
        .getRepository(InventoryItem)
        .existsBy({ id: inventoryItemId, householdId });
      if (!exists) throw new NotFoundException('库存项不存在');
    }
    const rows = await this.batches.find({
      where: {
        householdId,
        ...(inventoryItemId ? { inventoryItemId } : {}),
      },
      order: { expiresOn: 'ASC', receivedOn: 'ASC', createdAt: 'ASC' },
    });
    const today = await this.today(householdId);
    const presented = rows.map((batch) => this.present(batch, warningDays, today));
    if (status === 'all') return presented;
    if (status === 'active') {
      return presented.filter((batch) => Number(batch.quantity) > 0);
    }
    return presented.filter((batch) => batch.status === status);
  }

  async summaries(householdId: string, items: InventoryItem[], warningDays = 7) {
    if (!items.length) return new Map<string, ReturnType<typeof this.summary>>();
    const rows = await this.batches.find({
      where: { householdId, inventoryItemId: In(items.map((item) => item.id)) },
      order: { expiresOn: 'ASC', receivedOn: 'ASC', createdAt: 'ASC' },
    });
    const byItem = new Map<string, InventoryBatch[]>();
    for (const batch of rows) {
      byItem.set(batch.inventoryItemId, [
        ...(byItem.get(batch.inventoryItemId) ?? []),
        batch,
      ]);
    }
    const today = await this.today(householdId);
    return new Map(
      items.map((item) => [
        item.id,
        this.summary(item, byItem.get(item.id) ?? [], warningDays, today),
      ]),
    );
  }

  async create(input: CreateInventoryBatchInput, user: JwtUser) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('批次数量必须大于 0');
    }
    if (input.quantity > MAX_QUANTITY) {
      throw new BadRequestException(`批次数量不能超过 ${MAX_QUANTITY}`);
    }
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new BadRequestException('需要提供幂等键');
    const dates = normalizeDates(input, await this.today(user.householdId));
    const id = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-batch-key:${user.householdId}:${idempotencyKey}`,
      ]);
      const existing = await manager.getRepository(InventoryBatchMovement).findOneBy({
        householdId: user.householdId,
        idempotencyKey: `batch-registration:${idempotencyKey}`,
      });
      if (existing) {
        const batch = await manager.getRepository(InventoryBatch).findOneBy({
          id: existing.batchId,
          householdId: user.householdId,
        });
        if (
          !batch ||
          batch.inventoryItemId !== input.inventoryItemId ||
          Number(existing.delta) !== roundQuantity(input.quantity) ||
          batch.receivedOn !== dates.receivedOn ||
          batch.productionDate !== dates.productionDate ||
          batch.expiresOn !== dates.expiresOn ||
          batch.openedOn !== dates.openedOn
        ) {
          throw new ConflictException('这个幂等键已经用于其他批次登记');
        }
        return existing.batchId;
      }
      const item = await manager
        .getRepository(InventoryItem)
        .createQueryBuilder('item')
        .where('item.id = :id', { id: input.inventoryItemId })
        .andWhere('item.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!item) throw new NotFoundException('库存项不存在');
      const batches = await this.lockBatches(manager, user.householdId, item.id);
      const tracked = roundQuantity(
        batches.reduce((sum, batch) => sum + Number(batch.quantity), 0),
      );
      const untracked = roundQuantity(Number(item.quantity) - tracked);
      if (untracked < -0.001) {
        throw new ConflictException('库存批次数量与总库存不一致，请先检查流水');
      }
      if (input.quantity > untracked + 0.001) {
        throw new ConflictException(
          `最多只能登记 ${Math.max(0, untracked)} ${item.unit} 未分批库存`,
        );
      }
      const batchId = randomUUID();
      const batch = await manager.getRepository(InventoryBatch).save(
        manager.getRepository(InventoryBatch).create({
          id: batchId,
          householdId: user.householdId,
          inventoryItemId: item.id,
          quantity: quantityString(input.quantity),
          ...dates,
          sourceType: 'manual',
          sourceId: batchId,
          version: 1,
          createdById: user.memberId,
        }),
      );
      await manager.getRepository(InventoryBatchMovement).save(
        this.createMovement(manager, {
          householdId: user.householdId,
          batchId: batch.id,
          inventoryTransactionId: null,
          operationId: randomUUID(),
          type: 'allocation',
          quantityBefore: 0,
          delta: input.quantity,
          quantityAfter: input.quantity,
          actor: user,
          sourceType: 'batch_registration',
          sourceId: batch.id,
          idempotencyKey: `batch-registration:${idempotencyKey}`,
        }),
      );
      return batch.id;
    });
    return this.get(id, user.householdId);
  }

  async update(id: string, input: UpdateInventoryBatchInput, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const batch = await manager
        .getRepository(InventoryBatch)
        .createQueryBuilder('batch')
        .where('batch.id = :id', { id })
        .andWhere('batch.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      if (!batch) throw new NotFoundException('库存批次不存在');
      if (batch.version !== input.expectedVersion) {
        throw new ConflictException('批次已经被其他成员更新，请刷新后重试');
      }
      const dates = normalizeDates({
        receivedOn:
          input.receivedOn === undefined ? batch.receivedOn : input.receivedOn,
        productionDate:
          input.productionDate === undefined
            ? batch.productionDate
            : input.productionDate,
        expiresOn:
          input.expiresOn === undefined ? batch.expiresOn : input.expiresOn,
        openedOn: input.openedOn === undefined ? batch.openedOn : input.openedOn,
      }, await this.today(user.householdId));
      Object.assign(batch, dates);
      batch.version += 1;
      await manager.getRepository(InventoryBatch).save(batch);
    });
    return this.get(id, user.householdId);
  }

  async createReceiptBatch(
    manager: EntityManager,
    input: {
      item: InventoryItem;
      quantity: number;
      transaction: InventoryTransaction;
      actor: JwtUser;
      sourceId: string;
      dates: BatchDatesInput;
    },
  ) {
    const existing = await manager.getRepository(InventoryBatch).findOneBy({
      householdId: input.actor.householdId,
      sourceType: 'shopping_item',
      sourceId: input.sourceId,
    });
    if (existing) return existing;
    const dates = normalizeDates(input.dates, await this.today(input.actor.householdId));
    const batch = await manager.getRepository(InventoryBatch).save(
      manager.getRepository(InventoryBatch).create({
        householdId: input.actor.householdId,
        inventoryItemId: input.item.id,
        quantity: quantityString(input.quantity),
        ...dates,
        sourceType: 'shopping_item',
        sourceId: input.sourceId,
        version: 1,
        createdById: input.actor.memberId,
      }),
    );
    await manager.getRepository(InventoryBatchMovement).save(
      this.createMovement(manager, {
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
    const allocations: ReturnType<typeof this.presentAllocation>[] = [];
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
        this.presentAllocation(batch, quantityBefore, consumed, quantityAfter),
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
        this.createMovement(manager, {
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
        this.createMovement(manager, {
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

  private async get(id: string, householdId: string) {
    const batch = await this.batches.findOneBy({ id, householdId });
    if (!batch) throw new NotFoundException('库存批次不存在');
    return this.present(batch, 7, await this.today(householdId));
  }

  private summary(
    item: InventoryItem,
    batches: InventoryBatch[],
    warningDays: number,
    today: string,
  ) {
    const active = batches.filter((batch) => Number(batch.quantity) > 0);
    const trackedQuantity = roundQuantity(
      active.reduce((sum, batch) => sum + Number(batch.quantity), 0),
    );
    const statuses = active.map((batch) => statusFor(batch, warningDays, today));
    return {
      trackedQuantity,
      untrackedQuantity: Math.max(
        0,
        roundQuantity(Number(item.quantity) - trackedQuantity),
      ),
      activeBatchCount: active.length,
      earliestExpiresOn:
        active
          .map((batch) => batch.expiresOn)
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null,
      expiringCount: statuses.filter((status) => status === 'expiring').length,
      expiredCount: statuses.filter((status) => status === 'expired').length,
    };
  }

  private present(batch: InventoryBatch, warningDays: number, today: string) {
    const status = statusFor(batch, warningDays, today);
    return {
      ...batch,
      status,
      daysRemaining: batch.expiresOn
        ? diffDays(today, batch.expiresOn)
        : null,
    };
  }

  private presentAllocation(
    batch: InventoryBatch,
    quantityBefore: number,
    quantity: number,
    quantityAfter: number,
  ) {
    return {
      batchId: batch.id,
      receivedOn: batch.receivedOn,
      productionDate: batch.productionDate,
      expiresOn: batch.expiresOn,
      openedOn: batch.openedOn,
      status: statusFor(batch, 7, todayInShanghai()),
      quantityBefore,
      quantity,
      quantityAfter,
    };
  }

  private async lockBatches(
    manager: EntityManager,
    householdId: string,
    inventoryItemId: string,
  ) {
    return manager
      .getRepository(InventoryBatch)
      .createQueryBuilder('batch')
      .where('batch.householdId = :householdId', { householdId })
      .andWhere('batch.inventoryItemId = :inventoryItemId', {
        inventoryItemId,
      })
      .orderBy('batch.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  private createMovement(
    manager: EntityManager,
    input: {
      householdId: string;
      batchId: string;
      inventoryTransactionId: string | null;
      operationId: string;
      type: InventoryBatchMovementType;
      quantityBefore: number;
      delta: number;
      quantityAfter: number;
      actor: JwtUser;
      sourceType: InventoryBatchMovementSourceType;
      sourceId: string;
      idempotencyKey: string;
      reversesMovementId?: string | null;
    },
  ) {
    const delta = roundQuantity(input.delta);
    if (!delta) throw new BadRequestException('批次数量变化不能为 0');
    return manager.getRepository(InventoryBatchMovement).create({
      householdId: input.householdId,
      batchId: input.batchId,
      inventoryTransactionId: input.inventoryTransactionId,
      operationId: input.operationId,
      type: input.type,
      quantityBefore: quantityString(input.quantityBefore),
      delta: quantityString(delta),
      quantityAfter: quantityString(input.quantityAfter),
      actorId: input.actor.memberId,
      actorName: input.actor.name,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      reversesMovementId: input.reversesMovementId ?? null,
    });
  }
}
