import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaRequest,
  MediaType,
  Poll,
  PollOption,
} from '../entities';
import { MediaExternalRefDto } from './media.dto';

export const STATUS_LABELS: Record<HouseholdMediaStatus, string> = {
  watchlist: '想看',
  voting: '投票中',
  scheduled: '已排期',
  watching: '观看中',
  completed: '已看完',
  dropped: '不再观看',
};

export const STATUS_TRANSITIONS: Record<
  HouseholdMediaStatus,
  HouseholdMediaStatus[]
> = {
  watchlist: ['voting', 'scheduled', 'watching', 'completed', 'dropped'],
  voting: ['watchlist', 'scheduled', 'dropped'],
  scheduled: ['watchlist', 'watching', 'completed', 'dropped'],
  watching: ['completed', 'dropped', 'watchlist'],
  completed: ['watchlist', 'watching'],
  dropped: ['watchlist'],
};

export function normalizeText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function titleDedupeKey(type: MediaType, title: string, year: number | null) {
  return `${type}:${year ?? 'unknown'}:${normalizeText(title).toLocaleLowerCase(
    'zh-CN',
  )}`;
}

export function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('观影日期不是有效的 YYYY-MM-DD 日期');
  }
  return value;
}

export function normalizeExternalRefs(refs: MediaExternalRefDto[] = []) {
  const normalized = refs.map((ref) => ({
    provider: ref.provider,
    externalId:
      ref.provider === 'imdb'
        ? normalizeText(ref.externalId).toLocaleLowerCase('en-US')
        : normalizeText(ref.externalId),
  }));
  if (normalized.some((ref) => !ref.externalId)) {
    throw new BadRequestException('外部编号不能为空');
  }
  const keys = normalized.map(
    (ref) => `${ref.provider}:${ref.externalId.toLocaleLowerCase('en-US')}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('外部编号不能重复');
  }
  return normalized;
}

export function present(entry: HouseholdMedia) {
  return {
    id: entry.id,
    householdId: entry.householdId,
    status: entry.status,
    scheduledFor: entry.scheduledFor,
    note: entry.note,
    mediaTitle: {
      id: entry.mediaTitle.id,
      type: entry.mediaTitle.type,
      title: entry.mediaTitle.title,
      originalTitle: entry.mediaTitle.originalTitle,
      year: entry.mediaTitle.year,
      overview: entry.mediaTitle.overview,
      posterUrl: entry.mediaTitle.posterUrl,
      externalRefs: (entry.mediaTitle.externalRefs ?? [])
        .map((ref) => ({
          id: ref.id,
          provider: ref.provider,
          externalId: ref.externalId,
          connectorKey: ref.connectorKey,
        }))
        .sort((left, right) => left.provider.localeCompare(right.provider)),
    },
    createdBy: {
      id: entry.createdBy.id,
      name: entry.createdBy.name,
      avatarEmoji: entry.createdBy.avatarEmoji,
    },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export async function hasActivePoll(
  manager: EntityManager,
  mediaId: string,
  householdId: string,
) {
  const polls = await manager
    .getRepository(Poll)
    .createQueryBuilder('poll')
    .leftJoin('poll.options', 'option')
    .where('poll.householdId = :householdId', { householdId })
    .andWhere('poll.status = :status', { status: 'open' })
    .andWhere('poll.isArchived = false')
    .andWhere(
      `((poll."sourceModule" = 'media' AND poll."sourceId" = :mediaId) OR option."mediaId" = :mediaId)`,
      { mediaId },
    )
    .distinct(true)
    .getMany();
  return polls.some(
    (poll) => !poll.closesAt || poll.closesAt.getTime() > Date.now(),
  );
}

export async function hasActiveRequest(
  manager: EntityManager,
  mediaId: string,
  householdId: string,
) {
  return manager.getRepository(MediaRequest).exists({
    where: [
      { householdId, householdMediaId: mediaId, status: 'pending' },
      { householdId, householdMediaId: mediaId, status: 'processing' },
    ],
  });
}

export async function hasMediaPollReference(
  manager: EntityManager,
  mediaId: string,
) {
  return manager.getRepository(PollOption).existsBy({ mediaId });
}
