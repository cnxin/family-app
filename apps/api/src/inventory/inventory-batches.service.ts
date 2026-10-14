import { Clock } from '../common/clock';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { Household, InventoryBatch, InventoryBatchMovement, InventoryItem } from '../entities';
import { householdToday } from '@family/shared';
import { PluginFacadeRegistry, toPluginTransaction } from '../system/plugin-facades.registry';
import { MAX_QUANTITY, roundQuantity, quantityString } from './inventory-quantity';
import {
  CreateInventoryBatchInput,
  UpdateInventoryBatchInput,
  normalizeDates,
  summary,
  present,
  lockBatches,
  createMovement,
} from './inventory-batches.rules';

@Injectable()
export class InventoryBatchesService {
  constructor(
    @InjectRepository(InventoryBatch)
    private readonly batches: Repository<InventoryBatch>,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly facades: PluginFacadeRegistry,
  ) {}

  async today(householdId: string): Promise<string> {
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
    const presented = rows.map((batch) => present(batch, warningDays, today));
    if (status === 'all') return presented;
    if (status === 'active') {
      return presented.filter((batch) => Number(batch.quantity) > 0);
    }
    return presented.filter((batch) => batch.status === status);
  }

  async summaries(householdId: string, items: InventoryItem[], warningDays = 7) {
    if (!items.length) return new Map<string, ReturnType<typeof summary>>();
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
        summary(item, byItem.get(item.id) ?? [], warningDays, today),
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
      const batches = await lockBatches(manager, user.householdId, item.id);
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
      const locationId =
        (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), user.householdId, input.locationId)) ?? item.defaultLocationId ?? null;
      const batch = await manager.getRepository(InventoryBatch).save(
        manager.getRepository(InventoryBatch).create({
          id: batchId,
          householdId: user.householdId,
          inventoryItemId: item.id,
          quantity: quantityString(input.quantity),
          locationId,
          locationUpdatedAt: locationId ? this.clock.now() : null,
          ...dates,
          sourceType: 'manual',
          sourceId: batchId,
          version: 1,
          createdById: user.memberId,
        }),
      );
      await manager.getRepository(InventoryBatchMovement).save(
        createMovement(manager, {
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

  /** 一跳改批次位置（「找不到 → 改」）。不动 version：位置不是日期，不和改日期的乐观锁打架。 */
  async setLocation(id: string, locationId: string | null, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const batch = await manager.getRepository(InventoryBatch).findOneBy({ id, householdId: user.householdId });
      if (!batch) throw new NotFoundException('库存批次不存在');
      const usable = (await this.facades.get('locations').usableLocationId(toPluginTransaction(manager), user.householdId, locationId)) ?? null;
      await manager
        .getRepository(InventoryBatch)
        .update({ id, householdId: user.householdId }, { locationId: usable, locationUpdatedAt: this.clock.now() });
    });
    return this.get(id, user.householdId);
  }

  private async get(id: string, householdId: string) {
    const batch = await this.batches.findOneBy({ id, householdId });
    if (!batch) throw new NotFoundException('库存批次不存在');
    return present(batch, 7, await this.today(householdId));
  }
}
