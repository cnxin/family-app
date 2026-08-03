import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { Response } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { memoryStorage } from 'multer';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { jwtSecret } from '../common/config';
import {
  FamilyMemory,
  FamilyMemoryCategory,
  FamilyMemoryOperation,
  FamilyMemoryOperationType,
  FamilyMemoryPhoto,
  FamilyMemorySourceModule,
} from '../entities';
import { UPLOAD_DIR } from '../upload/upload.module';

const MEMORY_CATEGORIES: FamilyMemoryCategory[] = [
  'daily',
  'celebration',
  'travel',
  'meal',
  'visit',
  'milestone',
  'other',
];
const MEMORY_SOURCE_MODULES: FamilyMemorySourceModule[] = [
  'calendar',
  'travel',
  'menu',
  'media',
  'visit',
];
const MEMORY_SOURCE_TABLES: Record<FamilyMemorySourceModule, string> = {
  calendar: 'calendar_events',
  travel: 'travel_plans',
  menu: 'menus',
  media: 'household_media',
  visit: 'visits',
};
const MEMORY_PHOTO_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const PRIVATE_MEMORY_UPLOAD_DIR = resolve(
  UPLOAD_DIR,
  '.private',
  'memories',
);
const MEMORY_PHOTO_ACCESS_TTL_SECONDS = 10 * 60;

class MemoryListQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';

  @IsOptional()
  @IsIn(MEMORY_CATEGORIES)
  category?: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class CreateMemoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  happenedOn: string;

  @IsIn(MEMORY_CATEGORIES)
  category: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  story?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(MEMORY_SOURCE_MODULES)
  sourceModule?: FamilyMemorySourceModule | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpdateMemoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  happenedOn?: string;

  @IsOptional()
  @IsIn(MEMORY_CATEGORIES)
  category?: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  story?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(MEMORY_SOURCE_MODULES)
  sourceModule?: FamilyMemorySourceModule | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class MemoryVersionOperationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UploadMemoryPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  caption?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

function normalizedText(value?: string | null) {
  return value?.trim() || null;
}

function normalizedRequiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(`${label}不能为空`);
  return normalized;
}

function normalizedTags(values?: string[]) {
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

function validDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('回忆日期不是有效日期');
  }
  return value;
}

function isAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

function fingerprint(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueViolation(error: unknown) {
  return (
    (error as { driverError?: { code?: string } })?.driverError?.code ??
    (error as { code?: string })?.code
  ) === '23505';
}

function photoExtension(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return extensions[mimeType] ?? '.bin';
}

@Injectable()
export class MemoriesService {
  private readonly signingSecret = jwtSecret();

  constructor(
    @InjectRepository(FamilyMemory)
    private readonly memories: Repository<FamilyMemory>,
    @InjectRepository(FamilyMemoryPhoto)
    private readonly photos: Repository<FamilyMemoryPhoto>,
    @InjectRepository(FamilyMemoryOperation)
    private readonly operations: Repository<FamilyMemoryOperation>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: MemoryListQueryDto, user: JwtUser) {
    const status = query.status ?? 'active';
    const builder = this.memoryBuilder().where(
      'memory.householdId = :householdId',
      { householdId: user.householdId },
    );
    if (status === 'active') builder.andWhere('memory.archivedAt IS NULL');
    if (status === 'archived') builder.andWhere('memory.archivedAt IS NOT NULL');
    if (query.category) {
      builder.andWhere('memory.category = :category', {
        category: query.category,
      });
    }
    const q = normalizedText(query.q);
    if (q) {
      builder.andWhere(
        '(memory.title ILIKE :q OR memory.story ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    const tag = normalizedText(query.tag);
    if (tag) {
      builder.andWhere('memory.tags @> CAST(:tag AS jsonb)', {
        tag: JSON.stringify([tag]),
      });
    }
    if (query.year) {
      builder.andWhere(
        'memory.happenedOn >= :yearStart AND memory.happenedOn < :yearEnd',
        {
          yearStart: `${query.year}-01-01`,
          yearEnd: `${query.year + 1}-01-01`,
        },
      );
    }
    const rows = await builder
      .orderBy('memory.happenedOn', 'DESC')
      .addOrderBy('memory.createdAt', 'DESC')
      .take(query.limit ?? 100)
      .getMany();
    return rows.map((memory) => this.presentMemory(memory, user));
  }

  async detail(id: string, user: JwtUser) {
    return this.presentMemory(
      await this.requireMemory(id, user.householdId),
      user,
    );
  }

  async create(dto: CreateMemoryDto, user: JwtUser) {
    const sourceModule = dto.sourceModule ?? null;
    const sourceId = dto.sourceId ?? null;
    this.assertSourcePair(sourceModule, sourceId);
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
    if (existing) return this.presentMemory(existing, user);

    try {
      const memoryId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotent(
          idempotencyKey,
          requestFingerprint,
          user,
          manager,
        );
        if (duplicate) return duplicate.id;
        await this.assertSource(
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
        await this.saveOperation(
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
      return this.detail(memoryId, user);
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
        this.assertSourcePair(memory.sourceModule, memory.sourceId);
        await this.assertSource(
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

  async uploadPhoto(
    memoryId: string,
    dto: UploadMemoryPhotoDto,
    file: Express.Multer.File | undefined,
    user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('没有收到回忆照片');
    const caption = normalizedText(dto.caption);
    const idempotencyKey = normalizedRequiredText(
      dto.idempotencyKey,
      '幂等键',
    );
    const requestFingerprint = createHash('sha256')
      .update(file.buffer)
      .update(JSON.stringify({ memoryId, caption, mimeType: file.mimetype }))
      .digest('hex');
    const existing = await this.findIdempotentPhoto(
      idempotencyKey,
      requestFingerprint,
      user.householdId,
    );
    if (existing) return this.presentPhoto(existing);

    const fileName = `${randomUUID()}${photoExtension(file.mimetype)}`;
    const directory = resolve(PRIVATE_MEMORY_UPLOAD_DIR, user.householdId);
    const path = resolve(directory, fileName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });

    try {
      const photoId = await this.dataSource.transaction(async (manager) => {
        const duplicate = await this.findIdempotentPhoto(
          idempotencyKey,
          requestFingerprint,
          user.householdId,
          manager,
        );
        if (duplicate) return duplicate.id;
        const memory = await manager
          .getRepository(FamilyMemory)
          .createQueryBuilder('memory')
          .setLock('pessimistic_write')
          .where('memory.id = :memoryId AND memory.householdId = :householdId', {
            memoryId,
            householdId: user.householdId,
          })
          .getOne();
        if (!memory) throw new NotFoundException('家庭回忆不存在');
        this.assertCanManage(memory, user);
        if (memory.archivedAt) {
          throw new ConflictException('已归档回忆不能继续添加照片');
        }
        const photos = manager.getRepository(FamilyMemoryPhoto);
        const photoCount = await photos.countBy({
          memoryId,
          householdId: user.householdId,
        });
        if (photoCount >= 6) {
          throw new ConflictException('每条家庭回忆最多保存 6 张照片');
        }
        const photo = await photos.save(
          photos.create({
            householdId: user.householdId,
            memoryId,
            caption,
            storageKey: fileName,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            createdById: user.memberId,
            idempotencyKey,
            requestFingerprint,
          }),
        );
        await recordActivity(manager, user, {
          module: 'memory',
          action: 'family_memory_photo_added',
          summary: `${user.name}为家庭回忆「${memory.title}」添加了照片`,
          targetPath: `/memories?memoryId=${memory.id}`,
          metadata: { memoryId: memory.id, photoId: photo.id },
        });
        return photo.id;
      });
      const photo = await this.photos.findOne({
        where: { id: photoId, householdId: user.householdId },
      });
      if (!photo) throw new NotFoundException('回忆照片不存在');
      return this.presentPhoto(photo);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      if (uniqueViolation(error)) {
        const duplicate = await this.findIdempotentPhoto(
          idempotencyKey,
          requestFingerprint,
          user.householdId,
        );
        if (duplicate) return this.presentPhoto(duplicate);
      }
      throw error;
    }
  }

  async photoContent(
    memoryId: string,
    photoId: string,
    expiresValue: string,
    signature: string,
  ) {
    const expires = Number(expiresValue);
    this.verifyPhotoAccess(photoId, expires, signature);
    const photo = await this.photos.findOneBy({ id: photoId, memoryId });
    if (!photo) throw new NotFoundException('回忆照片不存在');
    const path = this.photoPath(photo.householdId, photo.storageKey);
    let body: Buffer;
    try {
      body = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('回忆照片文件不存在');
      }
      throw error;
    }
    return { body, contentType: photo.mimeType, fileName: photo.storageKey };
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
    if (existing) return this.presentMemory(existing, user);

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
        this.assertCanManage(memory, user);
        if (memory.version !== dto.expectedVersion) {
          throw new ConflictException(
            `回忆已更新，请刷新后重试（当前 v${memory.version}）`,
          );
        }
        await apply(memory, manager);
        memory.version += 1;
        memory.updatedById = user.memberId;
        const saved = await manager.getRepository(FamilyMemory).save(memory);
        await this.saveOperation(
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
      return this.detail(memoryId, user);
    } catch (error) {
      return this.resolveIdempotencyRace(
        error,
        idempotencyKey,
        requestFingerprint,
        user,
      );
    }
  }

  private memoryBuilder() {
    return this.memories
      .createQueryBuilder('memory')
      .leftJoinAndSelect('memory.createdBy', 'createdBy')
      .leftJoinAndSelect('memory.updatedBy', 'updatedBy')
      .leftJoinAndSelect('memory.photos', 'photos')
      .leftJoinAndSelect('photos.createdBy', 'photoCreatedBy');
  }

  private async requireMemory(id: string, householdId: string) {
    const memory = await this.memoryBuilder()
      .where('memory.id = :id AND memory.householdId = :householdId', {
        id,
        householdId,
      })
      .getOne();
    if (!memory) throw new NotFoundException('家庭回忆不存在');
    return memory;
  }

  private assertCanManage(memory: FamilyMemory, user: JwtUser) {
    if (!isAdmin(user) && memory.createdById !== user.memberId) {
      throw new ForbiddenException('只能维护自己创建的家庭回忆');
    }
  }

  private assertSourcePair(
    sourceModule: FamilyMemorySourceModule | null,
    sourceId: string | null,
  ) {
    if (Boolean(sourceModule) !== Boolean(sourceId)) {
      throw new BadRequestException('来源类型和来源 ID 必须同时提供或同时留空');
    }
  }

  private async assertSource(
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

  private async saveOperation(
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
    const memory = await this.requireMemory(
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
    if (uniqueViolation(error)) {
      const existing = await this.findIdempotent(
        idempotencyKey,
        requestFingerprint,
        user,
      );
      if (existing) return this.presentMemory(existing, user);
    }
    throw error;
  }

  private async findIdempotentPhoto(
    idempotencyKey: string,
    requestFingerprint: string,
    householdId: string,
    manager?: EntityManager,
  ) {
    const photo = await (
      manager?.getRepository(FamilyMemoryPhoto) ?? this.photos
    ).findOneBy({ householdId, idempotencyKey });
    if (!photo) return null;
    if (photo.requestFingerprint !== requestFingerprint) {
      throw new ConflictException('幂等键已用于不同的回忆照片');
    }
    return photo;
  }

  private presentMemory(memory: FamilyMemory, user: JwtUser) {
    const photos = [...(memory.photos ?? [])].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    return {
      id: memory.id,
      title: memory.title,
      happenedOn: memory.happenedOn,
      category: memory.category,
      story: memory.story,
      tags: memory.tags,
      source: memory.sourceModule
        ? {
            module: memory.sourceModule,
            id: memory.sourceId,
            targetPath: this.sourceTargetPath(
              memory.sourceModule,
              memory.sourceId!,
            ),
          }
        : null,
      version: memory.version,
      photos: photos.map((photo) => this.presentPhoto(photo)),
      createdBy: {
        id: memory.createdBy.id,
        name: memory.createdBy.name,
        avatarEmoji: memory.createdBy.avatarEmoji,
      },
      updatedBy: {
        id: memory.updatedBy.id,
        name: memory.updatedBy.name,
        avatarEmoji: memory.updatedBy.avatarEmoji,
      },
      archivedAt: memory.archivedAt,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      canEdit: isAdmin(user) || memory.createdById === user.memberId,
    };
  }

  private presentPhoto(photo: FamilyMemoryPhoto) {
    const expires = Math.floor(Date.now() / 1000) + MEMORY_PHOTO_ACCESS_TTL_SECONDS;
    const signature = this.signPhotoAccess(photo.id, expires);
    return {
      id: photo.id,
      caption: photo.caption,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      contentUrl: `/memories/${photo.memoryId}/photos/${photo.id}/content?expires=${expires}&signature=${signature}`,
      createdBy: photo.createdBy
        ? {
            id: photo.createdBy.id,
            name: photo.createdBy.name,
            avatarEmoji: photo.createdBy.avatarEmoji,
          }
        : null,
      createdAt: photo.createdAt,
    };
  }

  private sourceTargetPath(
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

  private signPhotoAccess(photoId: string, expires: number) {
    return createHmac('sha256', this.signingSecret)
      .update(`family-memory-photo:${photoId}:${expires}`)
      .digest('hex');
  }

  private verifyPhotoAccess(
    photoId: string,
    expires: number,
    signature: string,
  ) {
    if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('回忆照片访问地址已过期');
    }
    const expected = this.signPhotoAccess(photoId, expires);
    const actualBuffer = Buffer.from(signature || '', 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('回忆照片访问签名无效');
    }
  }

  private photoPath(householdId: string, storageKey: string) {
    const fileName = basename(storageKey);
    if (!fileName || fileName !== storageKey) {
      throw new ForbiddenException('回忆照片存储路径无效');
    }
    const directory = resolve(PRIVATE_MEMORY_UPLOAD_DIR, householdId);
    const path = resolve(directory, fileName);
    if (!path.startsWith(`${directory}${sep}`)) {
      throw new ForbiddenException('回忆照片存储路径无效');
    }
    return path;
  }
}

@Controller()
export class MemoriesController {
  constructor(private readonly service: MemoriesService) {}

  @Get('memories')
  list(@Query() query: MemoryListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('memories/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('memories')
  create(@Body() dto: CreateMemoryDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('memories/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('memories/:id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: MemoryVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archive(id, dto, user);
  }

  @Post('memories/:id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: MemoryVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restore(id, dto, user);
  }

  @Post('memories/:id/photos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) =>
        MEMORY_PHOTO_MIME_TYPES.has(file.mimetype)
          ? callback(null, true)
          : callback(
              new BadRequestException('回忆照片只支持 GIF、JPEG、PNG 或 WebP'),
              false,
            ),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadPhoto(
    @Param('id') id: string,
    @Body() dto: UploadMemoryPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.uploadPhoto(id, dto, file, user);
  }

  @Public()
  @Get('memories/:memoryId/photos/:photoId/content')
  async photoContent(
    @Param('memoryId') memoryId: string,
    @Param('photoId') photoId: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ) {
    const content = await this.service.photoContent(
      memoryId,
      photoId,
      expires,
      signature,
    );
    const extension = extname(content.fileName).toLowerCase();
    response.setHeader('Content-Type', content.contentType);
    response.setHeader('Content-Length', String(content.body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="family-memory${extension}"`,
    );
    response.status(200).end(content.body);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FamilyMemory,
      FamilyMemoryPhoto,
      FamilyMemoryOperation,
    ]),
  ],
  controllers: [MemoriesController],
  providers: [MemoriesService],
  exports: [MemoriesService],
})
export class MemoriesModule {}
