import { useState } from 'react';
import type {
  HouseholdMedia,
  HouseholdPoll,
  MediaLibraryMatch,
  MediaRequest,
} from '@family/contracts';
import {
  MEDIA_REQUEST_STATUS_LABELS,
  MEDIA_STATUS_LABELS,
  MEDIA_STATUS_STYLE,
  mediaAsset,
} from '../lib/queries';
import { Button, Checkbox } from './ui';

function scheduleLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00`));
}

function Poster({ entry }: { entry: HouseholdMedia }) {
  const [failed, setFailed] = useState(false);
  const src = mediaAsset(entry.mediaTitle.posterUrl);
  if (!src || failed) {
    return <span className="grid h-[108px] w-[72px] shrink-0 place-items-center rounded bg-muted text-xl">🎞️</span>;
  }
  return (
    <img
      src={src}
      alt=""
      className="h-[108px] w-[72px] shrink-0 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function MediaWatchlistCard({
  entry,
  libraries,
  request,
  poll,
  moviePilotOnline,
  selecting,
  selected,
  onToggleSelect,
  onEdit,
  onRemove,
  onPoll,
  onSubscribe,
  onLinkTmdb,
  onRefreshRequest,
  onCancelRequest,
  busy,
}: {
  entry: HouseholdMedia;
  libraries: MediaLibraryMatch[];
  request: MediaRequest | null;
  poll: HouseholdPoll | null;
  moviePilotOnline: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onPoll: () => void;
  onSubscribe: () => void;
  onLinkTmdb: () => void;
  onRefreshRequest: () => void;
  onCancelRequest: () => void;
  busy: boolean;
}) {
  const tmdb = entry.mediaTitle.externalRefs.find(
    (ref) => ref.provider === 'tmdb' && /^\d+$/.test(ref.externalId),
  );
  const canSubscribe =
    moviePilotOnline &&
    Boolean(tmdb) &&
    (!request || request.status === 'failed' || request.status === 'cancelled');
  const canPoll = Boolean(poll) || entry.status === 'watchlist' || entry.status === 'voting';

  return (
    <article
      aria-label={entry.mediaTitle.title}
      className="flex gap-3 rounded-card border border-border p-3"
    >
      <Poster key={entry.mediaTitle.posterUrl ?? entry.id} entry={entry} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium">
            {entry.mediaTitle.title}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${MEDIA_STATUS_STYLE[entry.status]}`}
          >
            {MEDIA_STATUS_LABELS[entry.status]}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {entry.mediaTitle.type === 'movie' ? '电影' : '剧集'}
          {entry.mediaTitle.year ? ` · ${entry.mediaTitle.year}` : ''}
          {entry.scheduledFor ? ` · ${scheduleLabel(entry.scheduledFor)}` : ''}
        </p>
        {entry.note ? (
          <p className="mt-1 line-clamp-2 text-[12px] text-ink-soft">{entry.note}</p>
        ) : null}

        {libraries.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {libraries.map((match) => {
              const url = mediaAsset(match.playbackUrl);
              return url ? (
                <a
                  key={`${match.connectorKey}:${match.libraryItemId}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`用${match.name}播放${entry.mediaTitle.title}`}
                  className="inline-flex h-8 items-center rounded-lg bg-accent-soft px-2.5 text-[12px] text-accent"
                >
                  ▶ {match.name}
                </a>
              ) : (
                <span
                  key={`${match.connectorKey}:${match.libraryItemId}`}
                  className="inline-flex h-8 items-center rounded-lg bg-muted px-2.5 text-[12px] text-ink-soft"
                >
                  {match.name} 里有
                </span>
              );
            })}
          </div>
        ) : null}

        {request ? (
          <div className="mt-2 rounded-lg bg-muted px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px]">
                MoviePilot{request.season ? ` · 第 ${request.season} 季` : ''} ·{' '}
                {MEDIA_REQUEST_STATUS_LABELS[request.status] ?? request.status}
              </span>
              {request.status !== 'completed' && request.status !== 'cancelled' ? (
                <Button
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-[12px]"
                  aria-label={`刷新${entry.mediaTitle.title}的订阅状态`}
                  disabled={busy}
                  onClick={onRefreshRequest}
                >
                  刷新
                </Button>
              ) : null}
              {request.canCancel ? (
                <Button
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-[12px] text-danger"
                  aria-label={`取消${entry.mediaTitle.title}的订阅`}
                  disabled={busy}
                  onClick={onCancelRequest}
                >
                  取消
                </Button>
              ) : null}
            </div>
            {request.message ? (
              <p
                className={
                  'mt-0.5 line-clamp-2 text-[12px] ' +
                  (request.status === 'failed' ? 'text-danger' : 'text-ink-soft')
                }
              >
                {request.message}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1 pt-1">
          {selecting ? (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selected}
                label={`${selected ? '不选' : '选上'}${entry.mediaTitle.title}`}
                onChange={onToggleSelect}
              />
              <span className="text-[12px] text-ink-soft">{selected ? '已选上' : '选进投票'}</span>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                className="h-8 px-2 text-[12px]"
                aria-label={`编辑${entry.mediaTitle.title}`}
                onClick={onEdit}
              >
                改安排
              </Button>
              {canPoll ? (
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[12px]"
                  aria-label={`${poll ? '查看' : '发起'}${entry.mediaTitle.title}的投票`}
                  onClick={onPoll}
                >
                  {poll ? '看投票' : '发起投票'}
                </Button>
              ) : null}
              {!request && !tmdb ? (
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[12px]"
                  aria-label={`给${entry.mediaTitle.title}补 TMDB`}
                  onClick={onLinkTmdb}
                >
                  补 TMDB
                </Button>
              ) : null}
              {canSubscribe ? (
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[12px]"
                  aria-label={`让 MoviePilot 找${entry.mediaTitle.title}`}
                  onClick={onSubscribe}
                >
                  {request ? '重新订阅' : '让它去找'}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="h-8 px-2 text-[12px] text-danger"
                aria-label={`移出片单${entry.mediaTitle.title}`}
                onClick={onRemove}
              >
                移出
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
