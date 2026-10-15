import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  FamilyMemory,
  FamilyMemoryOperation,
  FamilyMemoryOperationType,
  FamilyMemorySourceModule,
} from '../entities';
import { isHouseholdManager } from '@family/shared';

const MEMORY_SOURCE_TABLES: Record<FamilyMemorySourceModule, string> = {
  calendar: 'calendar_events',
  travel: 'travel_plans',
  menu: 'menus',
  media: 'household_media',
  visit: 'visits',
};

export function normalizedTags(values?: string[]) {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const tag = value.trim();
    const key = tag.toLocaleLowerCase('zh-CN');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function validDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('回忆日期不是有效日期');
  }
  return value;
}

export function assertCanManage(memory: FamilyMemory, user: JwtUser) {
  if (!isHouseholdManager(user) && memory.createdById !== user.memberId) {
    throw new ForbiddenException('只能维护自己创建的家庭回忆');
  }
}

export function assertSourcePair(
  sourceModule: FamilyMemorySourceModule | null,
  sourceId: string | null,
) {
  if (Boolean(sourceModule) !== Boolean(sourceId)) {
    throw new BadRequestException('来源类型和来源 ID 必须同时提供或同时留空');
  }
}

export async function assertSource(
  sourceModule: FamilyMemorySourceModule | null,
  sourceId: string | null,
  householdId: string,
  manager: EntityManager,
) {
  if (!sourceModule || !sourceId) return;
  const table = MEMORY_SOURCE_TABLES[sourceModule];
  const rows = (await manager.query(
    `SELECT 1 FROM "${table}" WHERE "id" = $1 AND "householdId" = $2 LIMIT 1`,
    [sourceId, householdId],
  )) as unknown[];
  if (!rows.length) throw new NotFoundException('关联的家庭事项不存在');
}

export async function saveOperation(
  manager: EntityManager,
  memory: FamilyMemory,
  operation: FamilyMemoryOperationType,
  idempotencyKey: string,
  requestFingerprint: string,
  user: JwtUser,
) {
  const repository = manager.getRepository(FamilyMemoryOperation);
  await repository.save(
    repository.create({
      householdId: memory.householdId,
      memoryId: memory.id,
      operation,
      resultVersion: memory.version,
      actorId: user.memberId,
      actorName: user.name,
      idempotencyKey,
      requestFingerprint,
    }),
  );
}

export function sourceTargetPath(
  sourceModule: FamilyMemorySourceModule,
  sourceId: string,
) {
  const paths: Record<FamilyMemorySourceModule, string> = {
    calendar: `/calendar?eventId=${sourceId}`,
    travel: `/travel?planId=${sourceId}`,
    menu: `/kitchen?menuId=${sourceId}`,
    media: `/media/watchlist?mediaId=${sourceId}`,
    visit: `/guests?visitId=${sourceId}`,
  };
  return paths[sourceModule];
}
