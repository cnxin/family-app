import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { StorageLocation } from '../entities';

/**
 * 库存 / 批次 / 资产引用位置前的检查（I1）：必须是这个家庭的、没归档的位置。
 * 只读一行。别的插件经位置门面调（J1b，locations.facade.ts），不直接 import 本文件。
 * undefined = 调用方没提这个字段；null = 清掉。
 */
export async function usableLocationId(
  manager: EntityManager,
  householdId: string,
  locationId: string | null | undefined,
): Promise<string | null | undefined> {
  if (locationId === undefined || locationId === null) return locationId;
  const row = await manager.getRepository(StorageLocation).findOne({
    where: { id: locationId, householdId },
    select: { id: true, archivedAt: true },
  });
  if (!row) throw new NotFoundException('这个位置不存在');
  if (row.archivedAt) throw new BadRequestException('这个位置已经归档了，换一个');
  return row.id;
}
