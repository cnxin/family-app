import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { MediaRequest, MediaRequestStatus, MediaTitle } from '../entities';

export function connectorErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || '连接 MoviePilot 失败').slice(0, 1000);
}

export async function lockRequest(
  manager: EntityManager,
  id: string,
  user: JwtUser,
) {
  const request = await manager
    .getRepository(MediaRequest)
    .createQueryBuilder('request')
    .innerJoinAndSelect('request.requestedBy', 'requestedBy')
    .leftJoinAndSelect('request.cancelledBy', 'cancelledBy')
    .where('request.id = :id AND request.householdId = :householdId', {
      id,
      householdId: user.householdId,
    })
    .setLock('pessimistic_write', undefined, ['request'])
    .getOne();
  if (!request) throw new NotFoundException('MoviePilot 订阅请求不存在');
  return request;
}

export function metadataSnapshot(title: MediaTitle) {
  return {
    type: title.type,
    title: title.title,
    originalTitle: title.originalTitle,
    year: title.year,
    overview: title.overview,
    posterUrl: title.posterUrl,
    metadata: title.metadata,
    externalRefs: (title.externalRefs ?? []).map((reference) => ({
      provider: reference.provider,
      mediaType: reference.mediaType,
      externalId: reference.externalId,
      connectorKey: reference.connectorKey ?? undefined,
    })),
  };
}

export function present(request: MediaRequest, user: JwtUser) {
  return {
    id: request.id,
    householdMediaId: request.householdMediaId,
    connectorKey: request.connectorKey,
    season: request.season,
    status: request.status as MediaRequestStatus,
    externalRequestId: request.externalRequestId,
    message: request.message,
    requestedBy: {
      id: request.requestedBy.id,
      name: request.requestedBy.name,
      avatarEmoji: request.requestedBy.avatarEmoji,
    },
    cancelledBy: request.cancelledBy
      ? {
          id: request.cancelledBy.id,
          name: request.cancelledBy.name,
          avatarEmoji: request.cancelledBy.avatarEmoji,
        }
      : null,
    canCancel:
      ['pending', 'processing'].includes(request.status) &&
      (request.requestedById === user.memberId ||
        user.role === 'owner' ||
        user.role === 'admin'),
    lastSyncedAt: request.lastSyncedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
