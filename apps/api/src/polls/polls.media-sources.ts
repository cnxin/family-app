import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMedia, Poll, PollOption } from '../entities';
import { type CreatePollBody } from '@family/contracts';
import { effectiveStatus } from './polls.helpers';

export async function prepareSource(
  dto: CreatePollBody,
  user: JwtUser,
  manager: EntityManager,
) {
  if (Boolean(dto.sourceModule) !== Boolean(dto.sourceId)) {
    throw new BadRequestException('投票来源模块和来源 ID 必须同时提供');
  }
  if (!dto.sourceModule || !dto.sourceId) return null;

  await lockMediaIds(manager, user.householdId, [dto.sourceId]);
  const entry = await manager
    .getRepository(HouseholdMedia)
    .createQueryBuilder('entry')
    .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
    .where('entry.id = :id AND entry.householdId = :householdId', {
      id: dto.sourceId,
      householdId: user.householdId,
    })
    .setLock('pessimistic_write')
    .getOne();
  if (!entry) throw new NotFoundException('观影片单不存在');
  if (entry.status !== 'watchlist' && entry.status !== 'voting') {
    throw new ConflictException('只有想看或投票中的影视可以发起投票');
  }

  await assertMediaAvailable(manager, user.householdId, entry.id);
  return { module: 'media' as const, id: entry.id, entry };
}

export async function prepareMediaCandidates(
  mediaIds: string[],
  user: JwtUser,
  manager: EntityManager,
) {
  await lockMediaIds(manager, user.householdId, mediaIds);
  const entries = await manager
    .getRepository(HouseholdMedia)
    .createQueryBuilder('entry')
    .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
    .where('entry.householdId = :householdId', {
      householdId: user.householdId,
    })
    .andWhere('entry.id IN (:...mediaIds)', { mediaIds })
    .setLock('pessimistic_write')
    .getMany();
  if (entries.length !== mediaIds.length) {
    throw new NotFoundException('候选影视不属于当前家庭片单');
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered = mediaIds.map((id) => byId.get(id) as HouseholdMedia);
  if (
    ordered.some(
      (entry) => entry.status !== 'watchlist' && entry.status !== 'voting',
    )
  ) {
    throw new ConflictException('只有想看或投票中的影视可以作为候选项');
  }
  for (const mediaId of mediaIds) {
    await assertMediaAvailable(manager, user.householdId, mediaId);
  }
  return ordered;
}

export async function syncMediaSources(
  manager: EntityManager,
  poll: Poll,
  user: JwtUser,
  action: 'closed' | 'reopened' | 'archived',
) {
  const mediaIds = await getPollMediaIds(manager, poll);
  if (!mediaIds.length) return;
  const entries = await manager
    .getRepository(HouseholdMedia)
    .createQueryBuilder('entry')
    .innerJoinAndSelect('entry.mediaTitle', 'mediaTitle')
    .where('entry.householdId = :householdId', {
      householdId: user.householdId,
    })
    .andWhere('entry.id IN (:...mediaIds)', { mediaIds })
    .setLock('pessimistic_write')
    .getMany();
  if (entries.length !== mediaIds.length) {
    if (action === 'reopened') {
      throw new ConflictException('部分候选片单已不存在，不能重新开启投票');
    }
  }

  if (action === 'reopened') {
    if (
      entries.some(
        (entry) => entry.status !== 'watchlist' && entry.status !== 'voting',
      )
    ) {
      throw new ConflictException('当前观影状态不能重新开启投票');
    }
    const changed = entries.filter((entry) => entry.status === 'watchlist');
    for (const entry of changed) {
      entry.status = 'voting';
      entry.scheduledFor = null;
    }
    if (changed.length) {
      await manager.getRepository(HouseholdMedia).save(changed);
    }
  } else {
    const changed: HouseholdMedia[] = [];
    for (const entry of entries) {
      if (
        entry.status === 'voting' &&
        !(await hasOtherActiveMediaPoll(manager, poll, entry.id))
      ) {
        entry.status = 'watchlist';
        entry.scheduledFor = null;
        changed.push(entry);
      }
    }
    if (changed.length) {
      await manager.getRepository(HouseholdMedia).save(changed);
    }
  }

  await recordActivity(manager, user, {
    module: 'media',
    action: `media_poll_${action}`,
    summary:
      action === 'reopened'
        ? `${user.name} 重新开启了包含 ${entries.length} 部影视的家庭投票`
        : `${user.name} ${action === 'closed' ? '结束' : '移除'}了包含 ${entries.length} 部影视的家庭投票`,
    targetPath: `/polls?pollId=${poll.id}`,
    metadata: { mediaIds: entries.map((entry) => entry.id), pollId: poll.id },
  });
}

export async function lockMediaPollSources(manager: EntityManager, poll: Poll) {
  await lockMediaIds(
    manager,
    poll.householdId,
    await getPollMediaIds(manager, poll),
  );
}

export async function assertNoOtherActiveMediaPoll(
  manager: EntityManager,
  poll: Poll,
) {
  for (const mediaId of await getPollMediaIds(manager, poll)) {
    await assertMediaAvailable(
      manager,
      poll.householdId,
      mediaId,
      poll.id,
    );
  }
}

async function assertMediaAvailable(
  manager: EntityManager,
  householdId: string,
  mediaId: string,
  excludePollId?: string,
) {
  const repository = manager.getRepository(Poll);
  const query = repository
    .createQueryBuilder('poll')
    .leftJoin('poll.options', 'option')
    .where('poll.householdId = :householdId', { householdId })
    .andWhere('poll.status = :status', { status: 'open' })
    .andWhere('poll.isArchived = false')
    .andWhere(
      `((poll."sourceModule" = 'media' AND poll."sourceId" = :mediaId) OR option."mediaId" = :mediaId)`,
      { mediaId },
    )
    .distinct(true);
  if (excludePollId) {
    query.andWhere('poll.id <> :excludePollId', { excludePollId });
  }
  const existing = await query.getMany();
  for (const poll of existing) {
    if (effectiveStatus(poll) === 'open') {
      throw new ConflictException('候选影视已经有进行中的家庭投票');
    }
    poll.status = 'closed';
    poll.closedAt = poll.closesAt ?? new Date();
    await repository.save(poll);
  }
}

async function hasOtherActiveMediaPoll(
  manager: EntityManager,
  poll: Poll,
  mediaId: string,
) {
  const others = await manager
    .getRepository(Poll)
    .createQueryBuilder('poll')
    .leftJoin('poll.options', 'option')
    .where('poll.householdId = :householdId', {
      householdId: poll.householdId,
    })
    .andWhere(
      `((poll."sourceModule" = 'media' AND poll."sourceId" = :mediaId) OR option."mediaId" = :mediaId)`,
      { mediaId },
    )
    .andWhere('poll.id <> :id', { id: poll.id })
    .andWhere('poll.status = :status', { status: 'open' })
    .andWhere('poll.isArchived = false')
    .orderBy('poll.createdAt', 'DESC')
    .distinct(true)
    .getMany();
  return others.some((other) => effectiveStatus(other) === 'open');
}

async function getPollMediaIds(manager: EntityManager, poll: Poll) {
  const optionIds = await manager
    .getRepository(PollOption)
    .createQueryBuilder('option')
    .select('option.mediaId', 'mediaId')
    .where('option.pollId = :pollId', { pollId: poll.id })
    .andWhere('option.mediaId IS NOT NULL')
    .getRawMany<{ mediaId: string }>();
  return [
    ...(poll.sourceModule === 'media' && poll.sourceId ? [poll.sourceId] : []),
    ...optionIds.map((option) => option.mediaId),
  ].filter((id, index, values) => values.indexOf(id) === index);
}

async function lockMediaIds(
  manager: EntityManager,
  householdId: string,
  mediaIds: string[],
) {
  for (const mediaId of [...new Set(mediaIds)].sort()) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`poll-source:${householdId}:media:${mediaId}`],
    );
  }
}
