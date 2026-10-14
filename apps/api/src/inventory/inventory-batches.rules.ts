import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  InventoryBatch,
  InventoryBatchMovement,
  InventoryBatchMovementSourceType,
  InventoryBatchMovementType,
  InventoryItem,
} from '../entities';
import { addDays, diffDays, todayInShanghai } from '@family/shared';
import { roundQuantity, quantityString } from './inventory-quantity';

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
  /** I1：放哪儿；不填取物品的默认位置 */
  locationId?: string | null;
}

export interface UpdateInventoryBatchInput extends BatchDatesInput {
  expectedVersion: number;
}

export type ConsumptionSource = Extract<
  InventoryBatchMovementSourceType,
  'menu' | 'maintenance_record' | 'manual_adjustment' | 'inventory_transaction'
>;

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

export function normalizeDates(input: BatchDatesInput, today: string) {
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

export function fifoSort(a: InventoryBatch, b: InventoryBatch) {
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

export function summary(
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

export function present(batch: InventoryBatch, warningDays: number, today: string) {
  const status = statusFor(batch, warningDays, today);
  return {
    ...batch,
    status,
    daysRemaining: batch.expiresOn
      ? diffDays(today, batch.expiresOn)
      : null,
  };
}

export function presentAllocation(
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

export async function lockBatches(
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

export function createMovement(
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
