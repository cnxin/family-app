import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { FamilyMemory, FamilyMemoryOperation, FamilyMemoryOperationType } from '../entities';
import { rawFingerprint as fingerprint } from '../common/fingerprint';
import { isUniqueViolation, normalizedRequiredText, normalizedText } from '@family/shared';
import { CreateMemoryDto, UpdateMemoryDto, MemoryVersionOperationDto } from './memories.dto';
import {
  normalizedTags,
  validDate,
  assertCanManage,
  assertSourcePair,
  assertSource,
  saveOperation,
} from './memories.helpers';
import { MemoriesService } from './memories.service';

/** 回忆的写入：新建、修改、归档、恢复，带幂等键与操作记录（J7.2 从 MemoriesService 拆出；读取与展示仍在 MemoriesService）。 */
@Injectable()
export class MemoryWritesService {
  constructor(
    @InjectRepository(FamilyMemoryOperation)
    private readonly operations: Repository<FamilyMemoryOperation>,
    private readonly dataSource: DataSource,
    private readonly memoriesService: MemoriesService,
  ) {}

  async create(dto: CreateMemoryDto, user: JwtUser) {
    const sourceModule = dto.sourceModule ?? null;
    const sourceId = dto.sourceId ?? null;
    assertSourcePair(sourceModule, sourceId);
    const payload = {
      title: normalizedRequiredText(dto.title, '标题'),
      happenedOn: validDate(dto.happenedOn),
      category: dto.category,
      story: normalizedText(dto.story),
      tags: normalizedTags(dto.tags),
      sourceModule,
      sourceId,
    };
    const idempotencyKey = normalizedRequiredText(
      dto.idempotencyKey,
      '幂等键',
    );
    const requestFingerprint = fingerprint({ operation: 'create', ...payload });
    const existing = await this.findIdempotent(
      idempotencyKey,
      requestFingerprint,
      user,
    );
    if (existing) return this.memoriesService.presentMemory(existing, user);

    try {
      const memoryId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotent(
          idempotencyKey,
          requestFingerprint,
          user,
          manager,
        );
        if (duplicate) return duplicate.id;
        await assertSource(
          payload.sourceModule,
          payload.sourceId,
          user.householdId,
          manager,
        );
        const repository = manager.getRepository(FamilyMemory);
        const memory = await repository.save(
          repository.create({
            householdId: user.householdId,
            ...payload,
            version: 1,
            createdById: user.memberId,
            updatedById: user.memberId,
            archivedAt: null,
          }),
        );
        await saveOperation(
          manager,
          memory,
          'create',
          idempotencyKey,
          requestFingerprint,
          user,
        );
        await recordActivity(manager, user, {
          module: 'memory',
          action: 'family_memory_created',
          summary: `${user.name}记录了家庭回忆「${memory.title}」`,
          targetPath: `/memories?memoryId=${memory.id}`,
          metadata: {
            memoryId: memory.id,
            category: memory.category,
            happenedOn: memory.happenedOn,
          },
        });
        return memory.id;
      });
      return this.memoriesService.detail(memoryId, user);
    } catch (error) {
      return this.resolveIdempotencyRace(
        error,
        idempotencyKey,
        requestFingerprint,
        user,
      );
    }
  }

  async update(id: string, dto: UpdateMemoryDto, user: JwtUser) {
    const fields = {
      ...(dto.title !== undefined
        ? { title: normalizedRequiredText(dto.title, '标题') }
        : {}),
      ...(dto.happenedOn !== undefined
        ? { happenedOn: validDate(dto.happenedOn) }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.story !== undefined ? { story: normalizedText(dto.story) } : {}),
      ...(dto.tags !== undefined ? { tags: normalizedTags(dto.tags) } : {}),
      ...(dto.sourceModule !== undefined
        ? { sourceModule: dto.sourceModule }
        : {}),
      ...(dto.sourceId !== undefined ? { sourceId: dto.sourceId } : {}),
    };
    if (!Object.keys(fields).length) {
      throw new BadRequestException('至少提供一个需要更新的字段');
    }
    return this.mutate(
      id,
      dto,
      'update',
      { operation: 'update', memoryId: id, ...fields },
      user,
      async (memory, manager) => {
        if (memory.archivedAt) {
          throw new ConflictException('已归档回忆需要先恢复再编辑');
        }
        Object.assign(memory, fields);
        assertSourcePair(memory.sourceModule, memory.sourceId);
        await assertSource(
          memory.sourceModule,
          memory.sourceId,
          user.householdId,
          manager,
        );
      },
      '更新',
    );
  }

  archive(id: string, dto: MemoryVersionOperationDto, user: JwtUser) {
    return this.mutate(
      id,
      dto,
      'archive',
      { operation: 'archive', memoryId: id },
      user,
      (memory) => {
        if (memory.archivedAt) throw new ConflictException('回忆已经归档');
        memory.archivedAt = new Date();
      },
      '归档',
    );
  }

  restore(id: string, dto: MemoryVersionOperationDto, user: JwtUser) {
    return this.mutate(
      id,
      dto,
      'restore',
      { operation: 'restore', memoryId: id },
      user,
      (memory) => {
        if (!memory.archivedAt) throw new ConflictException('回忆当前未归档');
        memory.archivedAt = null;
      },
      '恢复',
    );
  }

  private async mutate(
    id: string,
    dto: MemoryVersionOperationDto,
    operation: FamilyMemoryOperationType,
    fingerprintPayload: Record<string, unknown>,
    user: JwtUser,
    apply: (
      memory: FamilyMemory,
      manager: EntityManager,
    ) => void | Promise<void>,
    actionLabel: string,
  ) {
    const idempotencyKey = normalizedRequiredText(
      dto.idempotencyKey,
      '幂等键',
    );
    const requestFingerprint = fingerprint({
      ...fingerprintPayload,
      expectedVersion: dto.expectedVersion,
    });
    const existing = await this.findIdempotent(
      idempotencyKey,
      requestFingerprint,
      user,
    );
    if (existing) return this.memoriesService.presentMemory(existing, user);

    try {
      const memoryId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotent(
          idempotencyKey,
          requestFingerprint,
          user,
          manager,
        );
        if (duplicate) return duplicate.id;
        const memory = await manager
          .getRepository(FamilyMemory)
          .createQueryBuilder('memory')
          .setLock('pessimistic_write')
          .where('memory.id = :id AND memory.householdId = :householdId', {
            id,
            householdId: user.householdId,
          })
          .getOne();
        if (!memory) throw new NotFoundException('家庭回忆不存在');
        assertCanManage(memory, user);
        if (memory.version !== dto.expectedVersion) {
          throw new ConflictException(
            `回忆已更新，请刷新后重试（当前 v${memory.version}）`,
          );
        }
        await apply(memory, manager);
        memory.version += 1;
        memory.updatedById = user.memberId;
        const saved = await manager.getRepository(FamilyMemory).save(memory);
        await saveOperation(
          manager,
          saved,
          operation,
          idempotencyKey,
          requestFingerprint,
          user,
        );
        await recordActivity(manager, user, {
          module: 'memory',
          action: `family_memory_${operation}`,
          summary: `${user.name}${actionLabel}了家庭回忆「${saved.title}」`,
          targetPath: `/memories?memoryId=${saved.id}`,
          metadata: {
            memoryId: saved.id,
            category: saved.category,
            happenedOn: saved.happenedOn,
            version: saved.version,
          },
        });
        return saved.id;
      });
      return this.memoriesService.detail(memoryId, user);
    } catch (error) {
      return this.resolveIdempotencyRace(
        error,
        idempotencyKey,
        requestFingerprint,
        user,
      );
    }
  }

  private async findIdempotent(
    idempotencyKey: string,
    requestFingerprint: string,
    user: JwtUser,
    manager?: EntityManager,
  ) {
    const operation = await (
      manager?.getRepository(FamilyMemoryOperation) ?? this.operations
    ).findOneBy({ householdId: user.householdId, idempotencyKey });
    if (!operation) return null;
    if (operation.requestFingerprint !== requestFingerprint) {
      throw new ConflictException('幂等键已用于不同的家庭回忆操作');
    }
    const memory = await this.memoriesService.requireMemory(
      operation.memoryId,
      user.householdId,
    );
    return memory;
  }

  private async resolveIdempotencyRace(
    error: unknown,
    idempotencyKey: string,
    requestFingerprint: string,
    user: JwtUser,
  ) {
    if (isUniqueViolation(error)) {
      const existing = await this.findIdempotent(
        idempotencyKey,
        requestFingerprint,
        user,
      );
      if (existing) return this.memoriesService.presentMemory(existing, user);
    }
    throw error;
  }
}
