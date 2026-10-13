import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMedia, MediaRequest, MediaRequestStatus, MediaTitle } from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { MediaConnectorError } from './connectors';
import { isUniqueViolation } from '@family/shared';
import { MediaRequestQueryDto, CreateMediaRequestDto } from './media.dto';

function connectorErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : '';
  return (message || '连接 MoviePilot 失败').slice(0, 1000);
}

@Injectable()
export class MediaRequestsService {
  constructor(
    @InjectRepository(MediaRequest)
    private readonly mediaRequests: Repository<MediaRequest>,
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  async list(query: MediaRequestQueryDto, user: JwtUser) {
    const requests = await this.mediaRequests.find({
      where: {
        householdId: user.householdId,
        ...(query.mediaId ? { householdMediaId: query.mediaId } : {}),
      },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
    return requests.map((request) => this.present(request, user));
  }

  async create(mediaId: string, dto: CreateMediaRequestDto, user: JwtUser) {
    const connectorKey = dto.connectorKey ?? 'moviepilot';
    let reserved: {
      id: string;
      mediaTitle: MediaTitle;
      season: number;
    };
    try {
      reserved = await this.dataSource.transaction(async (manager) => {
        const entry = await manager
          .getRepository(HouseholdMedia)
          .createQueryBuilder('entry')
          .innerJoinAndSelect('entry.mediaTitle', 'title')
          .leftJoinAndSelect('title.externalRefs', 'externalRef')
          .where('entry.id = :mediaId AND entry.householdId = :householdId', {
            mediaId,
            householdId: user.householdId,
          })
          .setLock('pessimistic_write', undefined, ['entry'])
          .getOne();
        if (!entry) throw new NotFoundException('观影片单不存在');

        const tmdb = entry.mediaTitle.externalRefs.find(
          (reference) => reference.provider === 'tmdb',
        );
        if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
          throw new BadRequestException('提交 MoviePilot 前需要有效的 TMDB ID');
        }
        if (entry.mediaTitle.type === 'series' && !dto.season) {
          throw new BadRequestException('订阅剧集时需要选择季数');
        }
        if (entry.mediaTitle.type === 'movie' && dto.season != null) {
          throw new BadRequestException('电影订阅不需要选择季数');
        }
        const season = entry.mediaTitle.type === 'series' ? dto.season! : 0;
        const repository = manager.getRepository(MediaRequest);
        const request = await repository.save(
          repository.create({
            householdId: user.householdId,
            householdMediaId: entry.id,
            connectorKey,
            season,
            status: 'pending',
            externalRequestId: null,
            message: null,
            requestedById: user.memberId,
            cancelledById: null,
            lastSyncedAt: null,
          }),
        );
        await recordActivity(manager, user, {
          module: 'media',
          action: 'media_request_submitted',
          summary: `${user.name} 提交了「${entry.mediaTitle.title}」${season ? `第 ${season} 季` : ''}的 MoviePilot 订阅`,
          targetPath: `/media/watchlist?mediaId=${entry.id}`,
          metadata: {
            mediaId: entry.id,
            mediaRequestId: request.id,
            connectorKey,
            season,
          },
        });
        return { id: request.id, mediaTitle: entry.mediaTitle, season };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这部影视已有相同季数的进行中订阅');
      }
      throw error;
    }

    let externalRequest: Awaited<
      ReturnType<MediaConnectorsService['requestMedia']>
    >;
    try {
      externalRequest = await this.connectors.requestMedia(
        user.householdId,
        connectorKey,
        this.metadataSnapshot(reserved.mediaTitle),
        reserved.id,
        reserved.season ? { season: reserved.season } : {},
      );
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.failCreate(reserved.id, reserved.mediaTitle.title, message, user);
      throw new BadGatewayException(`MoviePilot 订阅失败：${message}`);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const request = await this.lockRequest(manager, reserved.id, user);
        request.status = externalRequest.status;
        request.externalRequestId = externalRequest.requestId;
        request.message = externalRequest.message?.slice(0, 1000) ?? null;
        request.lastSyncedAt = externalRequest.updatedAt;
        await manager.getRepository(MediaRequest).save(request);
        await recordActivity(manager, user, {
          module: 'media',
          action:
            request.status === 'completed'
              ? 'media_request_completed'
              : request.status === 'failed'
                ? 'media_request_failed'
                : 'media_request_accepted',
          summary:
            request.status === 'completed'
              ? `「${reserved.mediaTitle.title}」的 MoviePilot 订阅已完成`
              : request.status === 'failed'
                ? `「${reserved.mediaTitle.title}」的 MoviePilot 订阅失败`
                : `MoviePilot 已接收「${reserved.mediaTitle.title}」的订阅`,
          targetPath: `/media/watchlist?mediaId=${mediaId}`,
          metadata: {
            mediaId,
            mediaRequestId: request.id,
            connectorKey,
            season: request.season,
            status: request.status,
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const message = '这个 MoviePilot 订阅已关联到其他家庭请求';
      await this.failCreate(reserved.id, reserved.mediaTitle.title, message, user);
      throw new ConflictException(message);
    }
    return this.get(reserved.id, user);
  }

  async refresh(id: string, user: JwtUser) {
    const current = await this.getEntity(id, user);
    if (current.status === 'completed' || current.status === 'cancelled') {
      throw new ConflictException('已结束的订阅不能刷新');
    }

    let externalRequest: Awaited<
      ReturnType<MediaConnectorsService['getRequest']>
    >;
    try {
      externalRequest = current.externalRequestId
        ? await this.connectors.getRequest(
            user.householdId,
            current.connectorKey,
            current.externalRequestId,
          )
        : null;
      if (!externalRequest) {
        externalRequest = await this.findExternalRequest(current, user);
      }
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.recordSyncError(current.id, message, user);
      throw new BadGatewayException(`MoviePilot 状态同步失败：${message}`);
    }

    const title = await this.mediaTitle(current.householdMediaId, user);
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, current.id, user);
      if (request.status === 'completed' || request.status === 'cancelled') {
        throw new ConflictException('订阅状态已经结束，请重新载入最新状态');
      }
      const previousStatus = request.status;
      request.lastSyncedAt = new Date();
      if (!externalRequest) {
        request.status = 'failed';
        request.message = 'MoviePilot 中已找不到这条订阅';
      } else {
        request.externalRequestId = this.externalRequestIdForPersistence(
          externalRequest.requestId,
        );
        request.status = externalRequest.status;
        request.message = externalRequest.message?.slice(0, 1000) ?? null;
        request.lastSyncedAt = externalRequest.updatedAt;
      }
      await manager.getRepository(MediaRequest).save(request);
      if (
        request.status !== previousStatus &&
        (request.status === 'completed' || request.status === 'failed')
      ) {
        await recordActivity(manager, user, {
          module: 'media',
          action:
            request.status === 'completed'
              ? 'media_request_completed'
              : 'media_request_failed',
          summary:
            request.status === 'completed'
              ? `「${title}」的 MoviePilot 订阅已完成`
              : `「${title}」的 MoviePilot 订阅失败`,
          targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
          metadata: {
            mediaId: request.householdMediaId,
            mediaRequestId: request.id,
            connectorKey: request.connectorKey,
            season: request.season,
            status: request.status,
          },
        });
      }
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: JwtUser) {
    const current = await this.getEntity(id, user);
    if (!['pending', 'processing'].includes(current.status)) {
      throw new ConflictException('只有进行中的订阅可以取消');
    }
    if (
      current.requestedById !== user.memberId &&
      user.role !== 'owner' &&
      user.role !== 'admin'
    ) {
      throw new ForbiddenException('只有请求人或家庭管理员可以取消订阅');
    }
    let externalRequest: Awaited<
      ReturnType<MediaConnectorsService['getRequest']>
    > = null;

    try {
      if (current.externalRequestId) {
        externalRequest = await this.connectors.getRequest(
          user.householdId,
          current.connectorKey,
          current.externalRequestId,
        );
      }
      if (!externalRequest) {
        externalRequest = await this.findExternalRequest(current, user);
      }
      if (!externalRequest) {
        throw new MediaConnectorError('MoviePilot 中已找不到这条订阅或下载任务');
      }
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.recordSyncError(current.id, message, user);
      throw new BadGatewayException(`取消 MoviePilot 订阅失败：${message}`);
    }
    if (externalRequest.status === 'completed') {
      throw new ConflictException('MoviePilot 已完成整理，请刷新订阅状态');
    }

    try {
      await this.connectors.cancelRequest(
        user.householdId,
        current.connectorKey,
        externalRequest.requestId,
      );
    } catch (error) {
      const message = connectorErrorMessage(error);
      await this.recordSyncError(current.id, message, user);
      throw new BadGatewayException(`取消 MoviePilot 订阅失败：${message}`);
    }

    const title = await this.mediaTitle(current.householdMediaId, user);
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, current.id, user);
      if (!['pending', 'processing'].includes(request.status)) {
        throw new ConflictException('订阅状态已经发生变化，请刷新后重试');
      }
      request.externalRequestId = this.externalRequestIdForPersistence(
        externalRequest.requestId,
      );
      request.status = 'cancelled';
      request.cancelledById = user.memberId;
      request.message = null;
      request.lastSyncedAt = new Date();
      await manager.getRepository(MediaRequest).save(request);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_request_cancelled',
        summary: `${user.name} 取消了「${title}」${request.season ? `第 ${request.season} 季` : ''}的 MoviePilot 订阅`,
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
        metadata: {
          mediaId: request.householdMediaId,
          mediaRequestId: request.id,
          connectorKey: request.connectorKey,
          season: request.season,
        },
      });
    });
    return this.get(id, user);
  }

  private async get(id: string, user: JwtUser) {
    return this.present(await this.getEntity(id, user), user);
  }

  private async getEntity(id: string, user: JwtUser) {
    const request = await this.mediaRequests.findOne({
      where: { id, householdId: user.householdId },
    });
    if (!request) throw new NotFoundException('MoviePilot 订阅请求不存在');
    return request;
  }

  private async lockRequest(
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

  private async mediaTitle(mediaId: string, user: JwtUser) {
    return (await this.mediaTitleEntity(mediaId, user)).title;
  }

  private async mediaTitleEntity(mediaId: string, user: JwtUser) {
    const entry = await this.dataSource.manager.getRepository(HouseholdMedia).findOne({
      where: { id: mediaId, householdId: user.householdId },
      relations: { mediaTitle: { externalRefs: true } },
    });
    if (!entry) throw new NotFoundException('观影片单不存在');
    return entry.mediaTitle;
  }

  private async findExternalRequest(request: MediaRequest, user: JwtUser) {
    const title = await this.mediaTitleEntity(request.householdMediaId, user);
    return this.connectors.findRequest(
      user.householdId,
      request.connectorKey,
      this.metadataSnapshot(title),
      request.season ? { season: request.season } : {},
    );
  }

  private externalRequestIdForPersistence(requestId: string) {
    return requestId.startsWith('media-') ? null : requestId;
  }

  private metadataSnapshot(title: MediaTitle) {
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

  private async failCreate(
    id: string,
    title: string,
    message: string,
    user: JwtUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id, user);
      request.status = 'failed';
      request.message = message;
      request.lastSyncedAt = new Date();
      await manager.getRepository(MediaRequest).save(request);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_request_failed',
        summary: `「${title}」的 MoviePilot 订阅失败`,
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
        metadata: {
          mediaId: request.householdMediaId,
          mediaRequestId: request.id,
          connectorKey: request.connectorKey,
          season: request.season,
          message,
        },
      });
    });
  }

  private async recordSyncError(id: string, message: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const request = await this.lockRequest(manager, id, user);
      if (request.status === 'completed' || request.status === 'cancelled') {
        return;
      }
      request.message = `同步失败：${message}`.slice(0, 1000);
      await manager.getRepository(MediaRequest).save(request);
    });
  }

  private present(request: MediaRequest, user: JwtUser) {
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
}
