import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { Member, Notification, Poll, PollVoteMode } from '../entities';
import { isHouseholdManager } from '@family/shared';
import { type PollOptionInput } from '@family/contracts';

export function effectiveStatus(poll: Poll) {
  if (poll.status === 'closed') return 'closed' as const;
  if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
    return 'closed' as const;
  }
  return 'open' as const;
}

export function normalizeOptions(options: PollOptionInput[]) {
  const normalized = options.map((option) => ({
    label: option.label?.trim() || '',
    description: option.description?.trim() || null,
    mediaId: option.mediaId ?? null,
  }));
  const mediaOptionCount = normalized.filter((option) => option.mediaId).length;
  if (mediaOptionCount && mediaOptionCount !== normalized.length) {
    throw new BadRequestException('影视候选项不能和普通文字候选项混用');
  }
  if (!mediaOptionCount && normalized.some((option) => !option.label)) {
    throw new BadRequestException('候选项不能为空');
  }
  if (mediaOptionCount) {
    const mediaIds = normalized.map((option) => option.mediaId);
    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new BadRequestException('候选影视不能重复');
    }
  } else {
    const labels = normalized.map((option) =>
      option.label.toLocaleLowerCase('zh-CN'),
    );
    if (new Set(labels).size !== labels.length) {
      throw new BadRequestException('候选项不能重复');
    }
  }
  return normalized;
}

export function parseClosesAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException('截止时间无效');
  }
  return date;
}

export function present(poll: Poll, user: JwtUser) {
  const options = [...(poll.options ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const voterIds = new Set(
    options.flatMap((option) => [
      ...option.votes.map((vote) => `member:${vote.memberId}`),
      ...option.guestVotes.map((vote) => `guest:${vote.invitationId}`),
    ]),
  );
  const selectedOptionIds = options
    .filter((option) =>
      option.votes.some((vote) => vote.memberId === user.memberId),
    )
    .map((option) => option.id);
  const totalVoters = voterIds.size;
  const status = effectiveStatus(poll);
  return {
    id: poll.id,
    title: poll.title,
    description: poll.description,
    category: poll.category,
    voteMode: poll.voteMode,
    maxChoices: poll.maxChoices,
    closesAt: poll.closesAt?.toISOString() ?? null,
    status,
    sourceModule: poll.sourceModule,
    sourceId: poll.sourceId,
    createdById: poll.createdById,
    createdBy: poll.createdBy,
    closedById: poll.closedById,
    closedBy: poll.closedBy,
    closedAt: poll.closedAt?.toISOString() ?? null,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    canManage: poll.createdById === user.memberId || isHouseholdManager(user),
    canVote: status === 'open',
    totalVoters,
    totalVotes: options.reduce((sum, option) => sum + option.votes.length + option.guestVotes.length, 0),
    selectedOptionIds,
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      mediaId: option.mediaId,
      media: option.media
        ? {
            id: option.media.id,
            status: option.media.status,
            mediaTitle: {
              id: option.media.mediaTitle.id,
              type: option.media.mediaTitle.type,
              title: option.media.mediaTitle.title,
              originalTitle: option.media.mediaTitle.originalTitle,
              year: option.media.mediaTitle.year,
              posterUrl: option.media.mediaTitle.posterUrl,
            },
          }
        : null,
      sortOrder: option.sortOrder,
      voteCount: option.votes.length + option.guestVotes.length,
      percentage: totalVoters
        ? Math.round(((option.votes.length + option.guestVotes.length) / totalVoters) * 100)
        : 0,
      voters: option.votes
        .map((vote) => vote.member)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    })),
  };
}

export function validateRules(
  voteMode: PollVoteMode,
  maxChoices: number,
  optionCount: number,
) {
  if (voteMode === 'single' && maxChoices !== 1) {
    throw new BadRequestException('单选投票的最多选择数必须是 1');
  }
  if (voteMode === 'multiple' && maxChoices < 2) {
    throw new BadRequestException('多选投票至少允许选择 2 项');
  }
  if (maxChoices > optionCount) {
    throw new BadRequestException('最多选择数不能超过候选项数量');
  }
}

export function assertManageable(poll: Poll, user: JwtUser) {
  if (poll.createdById !== user.memberId && !isHouseholdManager(user)) {
    throw new ForbiddenException('只能管理自己发起的投票');
  }
}

export async function lockPoll(
  id: string,
  user: JwtUser,
  manager: EntityManager,
) {
  const poll = await manager
    .getRepository(Poll)
    .createQueryBuilder('poll')
    .where('poll.id = :id', { id })
    .andWhere('poll.householdId = :householdId', {
      householdId: user.householdId,
    })
    .andWhere('poll.isArchived = false')
    .setLock('pessimistic_write')
    .getOne();
  if (!poll) throw new NotFoundException('家庭投票不存在');
  return poll;
}

export async function notifyHousehold(
  manager: EntityManager,
  poll: Poll,
  actor: JwtUser,
  type: 'poll_created' | 'poll_closed' | 'poll_reopened',
  title: string,
) {
  const members = await manager.getRepository(Member).findBy({
    householdId: actor.householdId,
  });
  const recipients = members.filter((member) => member.id !== actor.memberId);
  if (!recipients.length) return;
  const notifications = manager.getRepository(Notification);
  await notifications.save(
    recipients.map((member) =>
      notifications.create({
        householdId: actor.householdId,
        recipientId: member.id,
        module: 'poll',
        type,
        sourceId: poll.id,
        title: title.slice(0, 160),
        body: poll.description?.slice(0, 500) || null,
        targetPath: `/polls?pollId=${poll.id}`,
      }),
    ),
  );
}
