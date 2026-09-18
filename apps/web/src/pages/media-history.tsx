import { useState } from 'react';
import type { ViewingSession, ViewingSessionStatus } from '@family/contracts';
import { mediaAsset, useViewingSessions } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { EmptyState, Page, Panel, Segmented } from '../components/ui';

type Filter = 'all' | 'active' | 'finished';

const STATUS_LABELS: Record<ViewingSessionStatus, string> = {
  active: '正在放',
  paused: '暂停了',
  stopped: '停了',
  completed: '看完了',
};

const STATUS_STYLE: Record<ViewingSessionStatus, string> = {
  active: 'bg-accent-soft text-accent',
  paused: 'bg-warm-soft text-warm',
  stopped: 'bg-muted text-ink-soft',
  completed: 'bg-accent-soft text-accent',
};

const NO_SESSIONS: ViewingSession[] = [];

function minutes(ms: number) {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(total / 60);
  return hours ? `${hours} 小时 ${total % 60} 分` : `${total} 分钟`;
}

function when(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function Poster({ session }: { session: ViewingSession }) {
  const [failed, setFailed] = useState(false);
  const src = mediaAsset(session.posterUrl);
  if (!src || failed) {
    return <span className="grid h-[72px] w-12 shrink-0 place-items-center rounded bg-muted">🎞️</span>;
  }
  return (
    <img
      src={src}
      alt=""
      className="h-[72px] w-12 shrink-0 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function MediaHistoryPage() {
  const { session } = useAuth();
  const meId = session?.member.id;
  const [filter, setFilter] = useState<Filter>('all');
  const history = useViewingSessions();

  const rows = history.data ?? NO_SESSIONS;
  const visible = rows.filter((one) =>
    filter === 'active'
      ? one.status === 'active' || one.status === 'paused'
      : filter === 'finished'
        ? one.status === 'stopped' || one.status === 'completed'
        : true,
  );
  const mine = rows.filter((one) =>
    one.participants.some((participant) => participant.member.id === meId),
  ).length;

  return (
    <Page
      title="观看记录"
      subtitle={
        <>
          <SoftLink to="/eat/media" className="text-accent hover:underline">
            ← 家庭观影
          </SoftLink>
          {' · '}
          一共 {rows.length} 次 · 有我的 {mine} 次
        </>
      }
      toolbar={
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: '全部' },
            { value: 'active' as const, label: '在放' },
            { value: 'finished' as const, label: '放完了' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {history.isPending ? (
          <ListSkeleton rows={4} />
        ) : history.isError ? (
          <EmptyState emoji="⏱️" title="记录读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : visible.length === 0 ? (
          <EmptyState
            emoji="⏱️"
            title={rows.length ? '这一档里没有记录' : '还没有播放记录'}
            hint="家里人在 Plex 或 Emby 上看片，这儿就会记一笔"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visible.map((one) => {
              const percent = Math.max(0, Math.min(100, one.percentage));
              const url = mediaAsset(one.playbackUrl);
              return (
                <article
                  key={one.id}
                  aria-label={one.title}
                  className="flex gap-3 rounded-card border border-border p-3"
                >
                  <Poster key={one.posterUrl ?? one.id} session={one} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-2">
                      <p className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium">
                        {one.title}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[one.status]}`}
                      >
                        {STATUS_LABELS[one.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                      {one.connectorName} · {when(one.lastEventAt)}
                      {one.deviceName ? ` · ${one.deviceName}` : ''}
                    </p>
                    <p className="truncate text-[12px] text-ink-soft">
                      {one.participants.map((participant) => participant.member.name).join('、') ||
                        '家里人'}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-ink-soft">
                      <span>
                        看到 {minutes(one.positionMs)}
                        {one.durationMs ? ` / ${minutes(one.durationMs)}` : ` · ${Math.round(percent)}%`}
                      </span>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`用${one.connectorName}打开${one.title}`}
                          className="text-accent hover:underline"
                        >
                          去{one.connectorName}接着看
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </Page>
  );
}
