import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMedia, MediaExternalRef, MediaTitle } from '../entities';
import { normalizeExternalRefs } from './media-rules';

/**
 * 给片单条目补外部编号（MediaService.addExternalRefs 的事务体，J7.2 拆出）。
 * 调用方负责开事务、校验编号格式、把唯一键冲突翻成 409、事后重新读条目。
 */
export async function linkMediaExternalRefs(
  manager: EntityManager,
  id: string,
  externalRefs: ReturnType<typeof normalizeExternalRefs>,
  user: JwtUser,
) {
  const entries = manager.getRepository(HouseholdMedia);
  const entry = await entries
    .createQueryBuilder('entry')
    .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
    .where('entry.id = :id AND entry.householdId = :householdId', {
      id,
      householdId: user.householdId,
    })
    .setLock('pessimistic_write')
    .getOne();
  if (!entry) throw new NotFoundException('观影片单不存在');

  const lockKeys = [
    `media-metadata:${entry.mediaTitleId}`,
    ...externalRefs.map((reference) =>
      reference.provider === 'tmdb'
        ? `external:${reference.provider}:${entry.mediaTitle.type}:${reference.externalId}`
        : `external:${reference.provider}:${reference.externalId}`,
    ),
  ].sort();
  for (const lockKey of lockKeys) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockKey],
    );
  }

  const titles = manager.getRepository(MediaTitle);
  const mediaTitle = await titles.findOne({
    where: { id: entry.mediaTitleId },
    relations: { externalRefs: true },
  });
  if (!mediaTitle) throw new NotFoundException('影视资料不存在');

  const existingByProvider = new Map(
    (mediaTitle.externalRefs ?? [])
      .filter((reference) => reference.connectorKey == null)
      .map((reference) => [reference.provider, reference]),
  );
  const refs = manager.getRepository(MediaExternalRef);
  const additions: typeof externalRefs = [];
  for (const reference of externalRefs) {
    const current = existingByProvider.get(reference.provider);
    if (current) {
      if (current.externalId !== reference.externalId) {
        throw new ConflictException(
          `这部影视已经关联其他 ${reference.provider.toUpperCase()} 编号`,
        );
      }
      continue;
    }

    const owner = await refs.findOne({
      where:
        reference.provider === 'tmdb'
          ? {
              provider: reference.provider,
              mediaType: mediaTitle.type,
              externalId: reference.externalId,
            }
          : {
              provider: reference.provider,
              externalId: reference.externalId,
            },
    });
    if (owner && owner.mediaTitleId !== mediaTitle.id) {
      throw new ConflictException('这个外部编号已经关联到其他影视条目');
    }
    if (!owner) additions.push(reference);
  }

  if (!additions.length) return;
  await refs.save(
    additions.map((reference) =>
      refs.create({
        mediaTitleId: mediaTitle.id,
        mediaType: mediaTitle.type,
        provider: reference.provider,
        externalId: reference.externalId,
        connectorKey: null,
        metadata: {},
      }),
    ),
  );
  await recordActivity(manager, user, {
    module: 'media',
    action: 'media_metadata_linked',
    summary: `${user.name} 补充了「${mediaTitle.title}」的影视编号`,
    targetPath: `/media?mediaId=${entry.id}&view=detail`,
    metadata: {
      mediaId: entry.id,
      mediaTitleId: mediaTitle.id,
      providers: additions.map((reference) => reference.provider),
    },
  });
}
