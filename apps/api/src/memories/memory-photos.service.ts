import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { jwtSecret } from '../common/config';
import { FamilyMemory, FamilyMemoryPhoto } from '../entities';
import { isUniqueViolation, normalizedRequiredText, normalizedText } from '@family/shared';
import { UploadMemoryPhotoDto } from './memories.dto';
import { assertCanManage } from './memories.helpers';
import { PRIVATE_MEMORY_UPLOAD_DIR } from './memories.service';

const MEMORY_PHOTO_ACCESS_TTL_SECONDS = 10 * 60;

function photoExtension(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return extensions[mimeType] ?? '.bin';
}

function photoPath(householdId: string, storageKey: string) {
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

/** 回忆照片：上传（带幂等键）、签名访问链接、按签名读原图（J7.2 从 MemoriesService 拆出）。 */
@Injectable()
export class MemoryPhotosService {
  private readonly signingSecret = jwtSecret();

  constructor(
    @InjectRepository(FamilyMemoryPhoto)
    private readonly photos: Repository<FamilyMemoryPhoto>,
    private readonly dataSource: DataSource,
  ) {}

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
        assertCanManage(memory, user);
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
      if (isUniqueViolation(error)) {
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
    const path = photoPath(photo.householdId, photo.storageKey);
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

  presentPhoto(photo: FamilyMemoryPhoto) {
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
}
