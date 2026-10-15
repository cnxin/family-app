import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { FamilyMemory } from '../entities';
import { UPLOAD_DIR } from '../upload/upload.module';
import { isHouseholdManager, normalizedText } from '@family/shared';
import { MemoryListQueryDto } from './memories.dto';
import { sourceTargetPath } from './memories.helpers';
import { MemoryPhotosService } from './memory-photos.service';

export const PRIVATE_MEMORY_UPLOAD_DIR = resolve(
  UPLOAD_DIR,
  '.private',
  'memories',
);

@Injectable()
export class MemoriesService {
  constructor(
    @InjectRepository(FamilyMemory)
    private readonly memories: Repository<FamilyMemory>,
    private readonly photoService: MemoryPhotosService,
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

  private memoryBuilder() {
    return this.memories
      .createQueryBuilder('memory')
      .leftJoinAndSelect('memory.createdBy', 'createdBy')
      .leftJoinAndSelect('memory.updatedBy', 'updatedBy')
      .leftJoinAndSelect('memory.photos', 'photos')
      .leftJoinAndSelect('photos.createdBy', 'photoCreatedBy');
  }

  async requireMemory(id: string, householdId: string) {
    const memory = await this.memoryBuilder()
      .where('memory.id = :id AND memory.householdId = :householdId', {
        id,
        householdId,
      })
      .getOne();
    if (!memory) throw new NotFoundException('家庭回忆不存在');
    return memory;
  }

  presentMemory(memory: FamilyMemory, user: JwtUser) {
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
            targetPath: sourceTargetPath(
              memory.sourceModule,
              memory.sourceId!,
            ),
          }
        : null,
      version: memory.version,
      photos: photos.map((photo) => this.photoService.presentPhoto(photo)),
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
      canEdit: isHouseholdManager(user) || memory.createdById === user.memberId,
    };
  }
}
