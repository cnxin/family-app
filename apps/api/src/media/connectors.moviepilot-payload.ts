import { MediaType } from '../entities';
import { MediaAutomationRequest, MediaExternalReference, MediaMetadataSnapshot } from './providers';
import {
  JsonRecord,
  MediaConnectorError,
  asRecord,
  asString,
  externalRefKey,
  integerOrNull,
} from './connectors';

export interface MoviePilotSubscription extends JsonRecord {
  id?: number;
  state?: string;
  tmdbid?: number;
  imdbid?: string;
  type?: string;
}

export interface MoviePilotMediaIdentity {
  mediaType: MediaType;
  tmdbId: string;
  season?: number;
}

export interface MoviePilotDownload extends JsonRecord {
  downloader?: string;
  hash?: string;
  progress?: number;
  media?: JsonRecord;
}

export interface MoviePilotDownloadHistory extends JsonRecord {
  tmdbid?: number;
  seasons?: string;
}

export interface MoviePilotTransferHistory extends MoviePilotDownloadHistory {
  id?: number;
  download_hash?: string;
  status?: boolean;
  errmsg?: string;
  date?: string;
  src?: string;
  src_fileitem?: JsonRecord;
}

export function mediaIdentity(
  media: MediaMetadataSnapshot,
  options: { season?: number } = {},
): MoviePilotMediaIdentity {
  const tmdb = media.externalRefs.find(
    (reference) => reference.provider === 'tmdb',
  );
  if (!tmdb || !/^\d+$/.test(tmdb.externalId)) {
    throw new MediaConnectorError('查找 MoviePilot 订阅需要有效的 TMDB ID');
  }
  const season = media.type === 'series' ? options.season : undefined;
  if (media.type === 'series' && (!season || season < 1)) {
    throw new MediaConnectorError('查找剧集订阅需要选择季数');
  }
  return {
    mediaType: media.type,
    tmdbId: tmdb.externalId,
    season,
  };
}

export function parseMediaRequestId(
  requestId: string,
): MoviePilotMediaIdentity | null {
  const match = /^media-(?:download|history|transfer):(movie|series):(\d+):(\d+)$/.exec(
    requestId,
  );
  if (!match) return null;
  const season = Number(match[3]);
  return {
    mediaType: match[1] as MediaType,
    tmdbId: match[2],
    season: season > 0 ? season : undefined,
  };
}

export function matchesIdentity(
  identity: MoviePilotMediaIdentity,
  tmdbId: unknown,
  season: unknown,
) {
  if (String(tmdbId ?? '') !== identity.tmdbId) return false;
  if (identity.mediaType === 'movie') return true;
  const numericSeason = integerOrNull(season);
  if (numericSeason != null) return numericSeason === identity.season;
  const seasonMatch = /S(\d+)/i.exec(asString(season) ?? '');
  return seasonMatch ? Number(seasonMatch[1]) === identity.season : false;
}

export function latestTransferBatch(histories: MoviePilotTransferHistory[]) {
  if (histories.length < 2) return histories;
  const ordered = [...histories].sort((left, right) => {
    const idDifference =
      (integerOrNull(right.id) ?? 0) - (integerOrNull(left.id) ?? 0);
    if (idDifference) return idDifference;
    return (asString(right.date) ?? '').localeCompare(
      asString(left.date) ?? '',
    );
  });
  const newest = ordered[0];
  const downloadHash = asString(newest.download_hash);
  const batch = downloadHash
    ? ordered.filter(
        (history) => asString(history.download_hash) === downloadHash,
      )
    : ordered;
  const latestBySource = new Map<string, MoviePilotTransferHistory>();
  const unkeyed: MoviePilotTransferHistory[] = [];
  for (const history of batch) {
    const source =
      asString(history.src) ?? asString(asRecord(history.src_fileitem).path);
    if (!source) {
      unkeyed.push(history);
    } else if (!latestBySource.has(source)) {
      latestBySource.set(source, history);
    }
  }
  return [...latestBySource.values(), ...unkeyed];
}

export function transferFailureReason(histories: MoviePilotTransferHistory[]) {
  const message = histories
    .map((history) => asString(history.errmsg)?.trim())
    .find((value): value is string => Boolean(value));
  if (!message) return null;
  if (message.includes('已存在')) return '目标文件已存在';
  return message.slice(0, 160);
}

export function present(
  subscription: MoviePilotSubscription,
  fallbackRefs: MediaExternalReference[],
): MediaAutomationRequest {
  const mediaType: MediaType =
    subscription.type === '电视剧' ? 'series' : 'movie';
  const externalRefs = [...fallbackRefs];
  if (subscription.tmdbid) {
    externalRefs.push({
      provider: 'tmdb',
      mediaType,
      externalId: String(subscription.tmdbid),
    });
  }
  if (subscription.imdbid) {
    externalRefs.push({
      provider: 'imdb',
      mediaType,
      externalId: subscription.imdbid,
    });
  }
  const refs = new Map(
    externalRefs.map((reference) => [externalRefKey(reference), reference]),
  );
  return {
    requestId: String(subscription.id),
    status: subscription.state === 'N' ? 'pending' : 'processing',
    externalRefs: [...refs.values()],
    updatedAt: new Date(),
  };
}
