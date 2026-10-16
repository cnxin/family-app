import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  AssetCategory,
  AssetDocument,
  HomeAsset,
  MaintenanceConsumable,
  MaintenancePlan,
  Reminder,
} from '../entities';

export const WARRANTY_CATEGORIES: AssetCategory[] = [
  'appliance',
  'electronics',
  'tool',
];

export const ASSET_FILE_PREFIX = 'asset-file://';

export interface MaintenanceInventoryConfirmation {
  operationId: string | null;
  reversed: boolean;
  transactions: {
    id: string;
    inventoryItemId: string;
    inventoryItemName: string;
    quantityBefore: string;
    delta: string;
    quantityAfter: string;
    unit: string;
    reversedAt: Date | null;
  }[];
}

export function nullableText(value: string | null | undefined) {
  return value?.trim() || null;
}

export function dateOnly(value: string | null | undefined, label: string) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label}必须使用 YYYY-MM-DD 格式`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label}不是有效日期`);
  }
  return value;
}

export function addMonths(value: string, months: number) {
  const source = new Date(`${value}T00:00:00.000Z`);
  const day = source.getUTCDate();
  const target = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

export function isExternalDocumentUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function present(
  asset: HomeAsset,
  inventoryConfirmations: Map<string, MaintenanceInventoryConfirmation>,
) {
  return {
    ...asset,
    documents: [...(asset.documents ?? [])]
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime(),
      )
      .map((document) => presentDocument(document)),
    maintenancePlans: [...(asset.maintenancePlans ?? [])]
      .map((plan) => ({
        ...plan,
        consumables: [...(plan.consumables ?? [])].sort((left, right) =>
          left.inventoryItem.name.localeCompare(
            right.inventoryItem.name,
            'zh-CN',
          ),
        ),
      }))
      .sort(
        (left, right) =>
          Number(right.isEnabled) - Number(left.isEnabled) ||
          left.nextDueDate.localeCompare(right.nextDueDate) ||
          left.title.localeCompare(right.title, 'zh-CN'),
      ),
    maintenanceRecords: [...(asset.maintenanceRecords ?? [])]
      .map((record) => ({
        ...record,
        inventoryConfirmation: inventoryConfirmations.get(record.id) ?? null,
      }))
      .sort(
        (left, right) =>
          right.performedAt.getTime() - left.performedAt.getTime(),
      ),
  };
}

export function consumablePreviewRows(
  consumables: MaintenanceConsumable[],
  householdId: string,
) {
  return consumables.map((consumable) => {
    const item = consumable.inventoryItem;
    if (!item || item.householdId !== householdId) {
      throw new ConflictException('维护耗材关联的库存项无效');
    }
    const quantity = roundQuantity(Number(consumable.quantity));
    const quantityBefore = roundQuantity(Number(item.quantity));
    if (!Number.isFinite(quantity) || !Number.isFinite(quantityBefore)) {
      throw new ConflictException('维护耗材或库存数量无效');
    }
    const unitMatches = item.unit === consumable.unit;
    const quantityAfter = unitMatches
      ? roundQuantity(quantityBefore - quantity)
      : null;
    const status: 'ready' | 'unit_mismatch' | 'insufficient' = !unitMatches
      ? 'unit_mismatch'
      : quantityAfter != null && quantityAfter < 0
        ? 'insufficient'
        : 'ready';
    return {
      consumableId: consumable.id,
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      quantity,
      unit: consumable.unit,
      currentUnit: item.unit,
      quantityBefore,
      quantityAfter,
      shortage: unitMatches
        ? roundQuantity(Math.max(quantity - quantityBefore, 0))
        : quantity,
      status,
    };
  });
}

export async function lockAsset(
  id: string,
  householdId: string,
  manager: EntityManager,
) {
  const asset = await manager
    .getRepository(HomeAsset)
    .createQueryBuilder('asset')
    .where('asset.id = :id', { id })
    .andWhere('asset.householdId = :householdId', { householdId })
    .setLock('pessimistic_write')
    .getOne();
  if (!asset) throw new NotFoundException('家庭资产不存在');
  return asset;
}

export async function lockPlan(
  id: string,
  householdId: string,
  manager: EntityManager,
) {
  const plan = await manager
    .getRepository(MaintenancePlan)
    .createQueryBuilder('plan')
    .leftJoinAndSelect('plan.asset', 'asset')
    .where('plan.id = :id', { id })
    .andWhere('plan.householdId = :householdId', { householdId })
    .andWhere('asset.householdId = :householdId', { householdId })
    .setLock('pessimistic_write')
    .getOne();
  if (!plan) throw new NotFoundException('维护计划不存在');
  return plan;
}

export function assertWarrantyDates(
  purchaseDate: string | null,
  warrantyExpiresOn: string | null,
) {
  if (
    purchaseDate &&
    warrantyExpiresOn &&
    warrantyExpiresOn < purchaseDate
  ) {
    throw new BadRequestException('保修到期日不能早于购买日期');
  }
}

export async function cancelScheduledReminders(
  manager: EntityManager,
  householdId: string,
  assetId: string,
  planId: string | null,
  reason: string,
) {
  const plans = planId
    ? [planId]
    : (
        await manager.getRepository(MaintenancePlan).findBy({
          householdId,
          assetId,
        })
      ).map((plan) => plan.id);
  if (!plans.length) return;
  await manager
    .getRepository(Reminder)
    .createQueryBuilder()
    .update()
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
    })
    .where('"householdId" = :householdId', { householdId })
    .andWhere('"sourceModule" = :sourceModule', {
      sourceModule: 'maintenance',
    })
    .andWhere('"sourceId" IN (:...plans)', { plans })
    .andWhere('status = :status', { status: 'scheduled' })
    .execute();
}

export function presentDocument(document: AssetDocument) {
  return {
    ...document,
    url: isExternalDocumentUrl(document.url) ? document.url : null,
  };
}
