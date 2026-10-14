import { MediaExternalProvider } from '../entities';
import {
  MediaAutomationProvider,
  MediaAutomationRequest,
  MediaExternalReference,
  MediaMetadataSnapshot,
  MediaProviderHealth,
} from './providers';
import { MediaConnectorConfig } from './connectors.config';
import {
  Fetcher,
  JsonRecord,
  MediaConnectorError,
  asRecord,
  asArray,
  asString,
  buildUrl,
  fetchJson,
  healthFailure,
} from './connectors';
import {
  MoviePilotSubscription,
  MoviePilotMediaIdentity,
  MoviePilotDownload,
  MoviePilotDownloadHistory,
  MoviePilotTransferHistory,
  mediaIdentity,
  parseMediaRequestId,
  matchesIdentity,
  latestTransferBatch,
  transferFailureReason,
  present,
} from './connectors.moviepilot-payload';

export class MoviePilotAutomationProvider implements MediaAutomationProvider {
  readonly provider: MediaExternalProvider = 'moviepilot';

  constructor(
    readonly config: MediaConnectorConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
    params?: URLSearchParams,
    timeoutMs = 10000,
  ) {
    if (!this.config.baseUrl || !this.config.credential) {
      throw new MediaConnectorError('尚未配置地址或 API Key');
    }
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-API-KEY', this.config.credential);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetchJson(
      this.fetcher,
      buildUrl(this.config.baseUrl, path, params),
      { ...init, headers },
      timeoutMs,
    );
  }

  async health(): Promise<MediaProviderHealth> {
    try {
      const body = asRecord(await this.request('/api/v1/system/env'));
      const version =
        asString(body.version) ??
        asString(asRecord(body.data).version) ??
        asString(asRecord(body.data).VERSION_FLAG);
      return {
        available: true,
        checkedAt: new Date(),
        message: version ? `MoviePilot ${version}` : 'MoviePilot 已连接',
      };
    } catch (error) {
      return healthFailure(error);
    }
  }

  async requestMedia(
    media: MediaMetadataSnapshot,
    _idempotencyKey: string,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest> {
    const tmdb = media.externalRefs.find(
      (reference) => reference.provider === 'tmdb',
    );
    if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
      throw new MediaConnectorError('MoviePilot 订阅需要有效的 TMDB ID');
    }
    const season = media.type === 'series' ? options.season : undefined;
    if (media.type === 'series' && (!season || season < 1)) {
      throw new MediaConnectorError('剧集订阅需要选择季数');
    }
    const mediaType = media.type === 'movie' ? '电影' : '电视剧';
    let response: JsonRecord;
    try {
      response = asRecord(
        await this.request(
          '/api/v1/subscribe/',
          {
            method: 'POST',
            body: JSON.stringify({
              name: media.title,
              year: media.year ? String(media.year) : undefined,
              type: mediaType,
              tmdbid: Number(tmdb.externalId),
              season,
            }),
          },
          undefined,
          30000,
        ),
      );
    } catch (error) {
      if (
        !(error instanceof MediaConnectorError) ||
        error.message !== '连接超时'
      ) {
        throw error;
      }

      // The POST may have completed in MoviePilot after the client timed out.
      try {
        const existing = await this.findSubscription(media, options);
        if (existing) return existing;
      } catch {
        // Preserve the actionable timeout below when confirmation also fails.
      }
      throw new MediaConnectorError(
        '订阅提交响应超时，请稍后重新提交以确认结果',
      );
    }
    if (response.success !== true) {
      throw new MediaConnectorError(
        asString(response.message) ?? 'MoviePilot 创建订阅失败',
      );
    }
    const id = asString(asRecord(response.data).id);
    if (!id) throw new MediaConnectorError('MoviePilot 未返回订阅编号');
    return present(
      {
        id: Number(id),
        state: 'N',
        type: mediaType,
        tmdbid: Number(tmdb.externalId),
      },
      media.externalRefs,
    );
  }

  async findRequest(
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest | null> {
    const identity = mediaIdentity(media, options);
    const subscription = await this.findSubscription(media, options);
    if (subscription) return subscription;
    return this.findMediaActivity(identity, media.externalRefs);
  }

  private async findSubscription(
    media: MediaMetadataSnapshot,
    options: { season?: number } = {},
  ): Promise<MediaAutomationRequest | null> {
    const identity = mediaIdentity(media, options);
    const body = asRecord(
      await this.request(
        `/api/v1/subscribe/media/${encodeURIComponent(`themoviedb:${identity.tmdbId}`)}`,
        {},
        identity.season
          ? new URLSearchParams({ season: String(identity.season) })
          : undefined,
      ),
    ) as MoviePilotSubscription;
    return body.id ? present(body, media.externalRefs) : null;
  }

  async getRequest(requestId: string): Promise<MediaAutomationRequest | null> {
    const mediaRequest = parseMediaRequestId(requestId);
    if (mediaRequest) {
      return this.findMediaActivity(mediaRequest, [
        {
          provider: 'tmdb',
          mediaType: mediaRequest.mediaType,
          externalId: mediaRequest.tmdbId,
        },
      ]);
    }
    const body = asRecord(
      await this.request(
        `/api/v1/subscribe/${encodeURIComponent(requestId)}`,
      ),
    );
    if (!body.id) return null;
    return present(body as MoviePilotSubscription, []);
  }

  async cancelRequest(requestId: string): Promise<MediaAutomationRequest> {
    const mediaRequest = parseMediaRequestId(requestId);
    if (mediaRequest) return this.cancelDownloads(mediaRequest);
    const existing = await this.getRequest(requestId);
    if (!existing) throw new MediaConnectorError('MoviePilot 订阅不存在');
    const body = asRecord(
      await this.request(`/api/v1/subscribe/${encodeURIComponent(requestId)}`, {
        method: 'DELETE',
      }),
    );
    if (body.success !== true) {
      throw new MediaConnectorError(
        asString(body.message) ?? '取消 MoviePilot 订阅失败',
      );
    }
    return { ...existing, status: 'cancelled', updatedAt: new Date() };
  }

  private mediaRequestId(
    stage: 'download' | 'history' | 'transfer',
    identity: MoviePilotMediaIdentity,
  ) {
    return `media-${stage}:${identity.mediaType}:${identity.tmdbId}:${identity.season ?? 0}`;
  }

  private async downloads(identity: MoviePilotMediaIdentity) {
    return asArray(await this.request('/api/v1/download/'))
      .map((value) => asRecord(value) as MoviePilotDownload)
      .filter((download) => {
        const media = asRecord(download.media);
        return matchesIdentity(
          identity,
          media.tmdbid ?? media.tmdb_id,
          media.season,
        );
      });
  }

  private async transferHistory(identity: MoviePilotMediaIdentity) {
    const response = asRecord(
      await this.request(
        '/api/v1/history/transfer',
        {},
        new URLSearchParams({ page: '1', count: '1000' }),
      ),
    );
    return asArray(asRecord(response.data).list)
      .map((value) => asRecord(value) as MoviePilotTransferHistory)
      .filter(
        (history) =>
          matchesIdentity(
            identity,
            history.tmdbid,
            history.seasons,
          ),
      );
  }

  private async downloadHistory(identity: MoviePilotMediaIdentity) {
    return asArray(
      await this.request(
        '/api/v1/history/download',
        {},
        new URLSearchParams({ page: '1', count: '1000' }),
      ),
    )
      .map((value) => asRecord(value) as MoviePilotDownloadHistory)
      .filter((history) =>
        matchesIdentity(identity, history.tmdbid, history.seasons),
      );
  }

  private async findMediaActivity(
    identity: MoviePilotMediaIdentity,
    externalRefs: MediaExternalReference[],
  ): Promise<MediaAutomationRequest | null> {
    const downloads = await this.downloads(identity);
    if (downloads.length) {
      const progress = Math.max(
        ...downloads.map((download) => Number(download.progress) || 0),
      );
      return {
        requestId: this.mediaRequestId('download', identity),
        status: 'processing',
        externalRefs,
        updatedAt: new Date(),
        message: `MoviePilot 下载中 · ${Math.round(progress)}%${downloads.length > 1 ? ` · ${downloads.length} 个任务` : ''}`,
      };
    }
    const transfers = latestTransferBatch(
      await this.transferHistory(identity),
    );
    const successfulTransfers = transfers.filter(
      (transfer) => transfer.status === true,
    );
    const failedTransfers = transfers.filter(
      (transfer) => transfer.status !== true,
    );
    if (failedTransfers.length) {
      const reason = transferFailureReason(failedTransfers);
      return {
        requestId: this.mediaRequestId('transfer', identity),
        status: 'failed',
        externalRefs,
        updatedAt: new Date(),
        message: `MoviePilot 整理不完整 · ${successfulTransfers.length} 成功 / ${failedTransfers.length} 失败${reason ? ` · ${reason}` : ''}`,
      };
    }
    if (successfulTransfers.length) {
      return {
        requestId: this.mediaRequestId('transfer', identity),
        status: 'completed',
        externalRefs,
        updatedAt: new Date(),
        message: 'MoviePilot 已完成整理',
      };
    }
    const history = await this.downloadHistory(identity);
    if (history.length) {
      return {
        requestId: this.mediaRequestId('history', identity),
        status: 'processing',
        externalRefs,
        updatedAt: new Date(),
        message: 'MoviePilot 已接收下载，等待整理完成',
      };
    }
    return null;
  }

  private async cancelDownloads(
    identity: MoviePilotMediaIdentity,
  ): Promise<MediaAutomationRequest> {
    const downloads = await this.downloads(identity);
    if (!downloads.length) {
      throw new MediaConnectorError('MoviePilot 中没有可取消的活动下载任务');
    }
    for (const download of downloads) {
      if (!download.hash) {
        throw new MediaConnectorError('MoviePilot 下载任务缺少任务编号');
      }
      const response = asRecord(
        await this.request(
          `/api/v1/download/${encodeURIComponent(download.hash)}`,
          { method: 'DELETE' },
          download.downloader
            ? new URLSearchParams({ name: download.downloader })
            : undefined,
        ),
      );
      if (response.success !== true) {
        throw new MediaConnectorError(
          asString(response.message) ?? '取消 MoviePilot 下载任务失败',
        );
      }
    }
    return {
      requestId: this.mediaRequestId('download', identity),
      status: 'cancelled',
      externalRefs: [
        {
          provider: 'tmdb',
          mediaType: identity.mediaType,
          externalId: identity.tmdbId,
        },
      ],
      updatedAt: new Date(),
    };
  }
}
