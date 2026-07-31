import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  HouseholdActivityLog,
  MediaRequest,
  MediaRequestStatus,
  MediaTitle,
  Notification,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import {
  MediaAutomationRequest,
  MediaMetadataSnapshot,
} from './providers';

const ACTIVE_STATUSES: MediaRequestStatus[] = ['pending', 'processing'];
const REVIEW_STATUSES: MediaRequestStatus[] = ['completed', 'failed'];
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 10_000;
const DEFAULT_FINAL_GRACE_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

interface ReconciliationState {
  status: MediaRequestStatus;
  externalRequestId: string | null;
  message: string | null;
  lastSyncedAt: Date;
}

export interface ReconciliationCurrentState {
  status: MediaRequestStatus;
  externalRequestId: string | null;
}

function configuredDuration(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const configured = Number(process.env[name] ?? fallback);
  return Number.isFinite(configured)
    ? Math.max(minimum, Math.min(configured, maximum))
    : fallback;
}

function persistedExternalRequestId(requestId: string) {
  return requestId.startsWith('media-') ? null : requestId.slice(0, 180);
}

export function reconciledMoviePilotState(
  current: ReconciliationCurrentState,
  external: MediaAutomationRequest | null,
  checkedAt = new Date(),
): ReconciliationState | null {
  if (!external) {
    return ACTIVE_STATUSES.includes(current.status)
      ? {
          status: 'failed',
          externalRequestId: current.externalRequestId,
          message: 'MoviePilot 中已找不到这条订阅或下载记录',
          lastSyncedAt: checkedAt,
        }
      : null;
  }
  return {
    status: external.status,
    externalRequestId: persistedExternalRequestId(external.requestId),
    message: external.message?.slice(0, 1000) ?? null,
    lastSyncedAt: external.updatedAt,
  };
}

function metadataSnapshot(title: MediaTitle): MediaMetadataSnapshot {
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

function statusChanged(
  current: MediaRequest,
  next: ReconciliationState,
) {
  return (
    current.status !== next.status ||
    current.externalRequestId !== next.externalRequestId ||
    current.message !== next.message
  );
}

@Injectable()
export class MoviePilotReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MoviePilotReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly connectors: MediaConnectorsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.MOVIEPILOT_RECONCILE_ENABLED === 'false') return;
    const interval = configuredDuration(
      'MOVIEPILOT_RECONCILE_INTERVAL_MS',
      DEFAULT_INTERVAL_MS,
      5_000,
      15 * 60 * 1000,
    );
    const initialDelay = configuredDuration(
      'MOVIEPILOT_RECONCILE_INITIAL_DELAY_MS',
      DEFAULT_INITIAL_DELAY_MS,
      1_000,
      interval,
    );
    this.initialTimer = setTimeout(() => this.runScheduled(), initialDelay);
    this.initialTimer.unref();
    this.timer = setInterval(() => this.runScheduled(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  async reconcileNow() {
    if (this.running) {
      return { skipped: true, checked: 0, changed: 0, failed: 0 };
    }
    this.running = true;
    let checked = 0;
    let changed = 0;
    let failed = 0;
    try {
      const requests = await this.candidates();
      for (const request of requests) {
        checked += 1;
        try {
          const external = await this.externalState(request);
          if (await this.applyState(request, external)) changed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `MoviePilot 后台对账跳过请求 ${request.id}：${
              error instanceof Error ? error.message : '未知错误'
            }`,
          );
        }
      }
      if (changed || failed) {
        this.logger.log(
          `MoviePilot 后台对账完成：检查 ${checked} 条，更新 ${changed} 条，失败 ${failed} 条`,
        );
      }
      return { skipped: false, checked, changed, failed };
    } finally {
      this.running = false;
    }
  }

  private runScheduled() {
    void this.reconcileNow().catch((error) => {
      this.logger.error(
        `MoviePilot 后台对账执行失败：${
          error instanceof Error ? error.message : '未知错误'
        }`,
      );
    });
  }

  private candidates() {
    const grace = configuredDuration(
      'MOVIEPILOT_RECONCILE_FINAL_GRACE_MS',
      DEFAULT_FINAL_GRACE_MS,
      60_000,
      7 * 24 * 60 * 60 * 1000,
    );
    return this.dataSource
      .getRepository(MediaRequest)
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.householdMedia', 'entry')
      .innerJoinAndSelect('entry.mediaTitle', 'title')
      .leftJoinAndSelect('title.externalRefs', 'externalRef')
      .where('request.connectorKey = :connectorKey', {
        connectorKey: 'moviepilot',
      })
      .andWhere(
        `(
          request.status IN (:...activeStatuses)
          OR (
            request.status IN (:...reviewStatuses)
            AND request."updatedAt" >= :reviewAfter
          )
        )`,
        {
          activeStatuses: ACTIVE_STATUSES,
          reviewStatuses: REVIEW_STATUSES,
          reviewAfter: new Date(Date.now() - grace),
        },
      )
      .orderBy('request.updatedAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }

  private async externalState(request: MediaRequest) {
    let external = request.externalRequestId
      ? await this.connectors.getRequest(
          request.householdId,
          request.connectorKey,
          request.externalRequestId,
        )
      : null;
    if (!external) {
      external = await this.connectors.findRequest(
        request.householdId,
        request.connectorKey,
        metadataSnapshot(request.householdMedia.mediaTitle),
        request.season ? { season: request.season } : {},
      );
    }
    return external;
  }

  private async applyState(
    candidate: MediaRequest,
    external: MediaAutomationRequest | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(MediaRequest)
        .createQueryBuilder('request')
        .innerJoinAndSelect('request.householdMedia', 'entry')
        .innerJoinAndSelect('entry.mediaTitle', 'title')
        .where('request.id = :id', { id: candidate.id })
        .setLock('pessimistic_write', undefined, ['request'])
        .getOne();
      if (!request || request.status === 'cancelled') return false;

      const next = reconciledMoviePilotState(request, external);
      if (!next || !statusChanged(request, next)) return false;
      if (
        REVIEW_STATUSES.includes(request.status) &&
        (await this.hasOtherActiveRequest(manager, request))
      ) {
        return false;
      }

      const previousStatus = request.status;
      request.status = next.status;
      request.externalRequestId = next.externalRequestId;
      request.message = next.message;
      request.lastSyncedAt = next.lastSyncedAt;
      await manager.getRepository(MediaRequest).save(request);

      if (previousStatus !== request.status) {
        await this.recordTransition(manager, request, previousStatus);
      }
      return true;
    });
  }

  private hasOtherActiveRequest(
    manager: EntityManager,
    request: MediaRequest,
  ) {
    return manager
      .getRepository(MediaRequest)
      .createQueryBuilder('other')
      .where('other.id <> :id', { id: request.id })
      .andWhere('other.householdId = :householdId', {
        householdId: request.householdId,
      })
      .andWhere('other.householdMediaId = :mediaId', {
        mediaId: request.householdMediaId,
      })
      .andWhere('other.connectorKey = :connectorKey', {
        connectorKey: request.connectorKey,
      })
      .andWhere('other.season = :season', { season: request.season })
      .andWhere('other.status IN (:...statuses)', {
        statuses: ACTIVE_STATUSES,
      })
      .getExists();
  }

  private async recordTransition(
    manager: EntityManager,
    request: MediaRequest,
    previousStatus: MediaRequestStatus,
  ) {
    if (request.status !== 'completed' && request.status !== 'failed') return;
    const title = request.householdMedia.mediaTitle.title;
    const season = request.season ? `第 ${request.season} 季` : '';
    const completed = request.status === 'completed';
    const body = completed
      ? `「${title}」${season}已完成整理，可以前往媒体库播放`
      : `「${title}」${season}：${request.message ?? '整理失败，请检查 MoviePilot'}`;
    await manager.getRepository(Notification).save(
      manager.getRepository(Notification).create({
        householdId: request.householdId,
        recipientId: request.requestedById,
        module: 'media',
        type: completed ? 'media_ready' : 'media_request_failed',
        sourceId: request.householdMediaId,
        title: completed ? '影片已就绪' : '媒体整理需要处理',
        body: body.slice(0, 500),
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}&view=detail`,
        readAt: null,
      }),
    );
    await manager.getRepository(HouseholdActivityLog).save(
      manager.getRepository(HouseholdActivityLog).create({
        householdId: request.householdId,
        actorId: null,
        actorName: '系统',
        subjectMemberId: request.requestedById,
        module: 'media',
        action: completed
          ? 'media_request_reconciled_completed'
          : 'media_request_reconciled_failed',
        summary: (completed
          ? `「${title}」的 MoviePilot 状态已自动同步为完成`
          : `「${title}」的 MoviePilot 状态已自动同步为失败`
        ).slice(0, 180),
        detail: request.message?.slice(0, 500) ?? null,
        targetPath: `/media/watchlist?mediaId=${request.householdMediaId}`,
        metadata: {
          mediaRequestId: request.id,
          previousStatus,
          status: request.status,
          connectorKey: request.connectorKey,
          season: request.season,
        },
      }),
    );
  }
}
