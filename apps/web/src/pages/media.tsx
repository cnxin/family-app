import type { HouseholdMedia } from '@family/contracts';
import {
  MEDIA_CONNECTOR_STATE_LABELS,
  mediaAsset,
  useMediaConnectors,
  useMediaEntries,
  useViewingSessions,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { legacyUrl } from '../lib/nav';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { EmptyState, Page, Panel } from '../components/ui';

const NO_ENTRIES: HouseholdMedia[] = [];

function scheduleLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00`));
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border px-3.5 py-3">
      <p className="text-[12px] text-ink-soft">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function MediaPage() {
  const { session } = useAuth();
  const canManage = session?.member.role !== 'member';

  const entries = useMediaEntries();
  const connectors = useMediaConnectors();
  const sessions = useViewingSessions();

  const rows = entries.data ?? NO_ENTRIES;
  const scheduled = rows
    .filter((one) => one.status === 'scheduled' && one.scheduledFor)
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));

  return (
    <Page
      title="家庭观影"
      subtitle={`今晚看什么 · 片单里一共 ${rows.length} 部`}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {entries.isPending ? (
          <Panel className="p-3">
            <ListSkeleton rows={3} />
          </Panel>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <Tile label="想看" value={rows.filter((one) => one.status === 'watchlist').length} />
              <Tile label="已排期" value={scheduled.length} />
              <Tile label="在看" value={rows.filter((one) => one.status === 'watching').length} />
            </div>

            <Panel title="接下来看这些">
              {scheduled.length === 0 ? (
                <EmptyState emoji="🎬" title="还没排片" hint="片单里挑一部，定个日子" />
              ) : (
                scheduled.slice(0, 6).map((entry, index) => {
                  const poster = mediaAsset(entry.mediaTitle.posterUrl);
                  return (
                    <a
                      key={entry.id}
                      href={legacyUrl(`/media/watchlist?mediaId=${entry.id}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        'flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted ' +
                        (index ? 'border-t border-border' : '')
                      }
                    >
                      {poster ? (
                        <img src={poster} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="grid h-14 w-10 shrink-0 place-items-center rounded bg-muted text-[15px]">
                          🎞️
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px]">{entry.mediaTitle.title}</p>
                        <p className="text-[12px] text-ink-soft">
                          {entry.scheduledFor ? scheduleLabel(entry.scheduledFor) : ''}
                        </p>
                      </div>
                    </a>
                  );
                })
              )}
            </Panel>
          </>
        )}
      </div>

      <aside className="flex shrink-0 flex-col gap-4 lg:w-[300px]">
        <Panel title="去哪儿看" grow={false}>
          <SoftLink to="/eat/media/watchlist" className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-muted">
            <span className="text-[15px]">🎬</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">家庭片单</p>
              <p className="text-[12px] text-ink-soft">{rows.length} 部影视</p>
            </div>
          </SoftLink>
          <SoftLink to="/eat/media/library" className="flex items-center gap-2 px-3.5 py-2.5 hover:bg-muted">
            <span className="text-[15px]">📚</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">我的媒体库</p>
              <p className="text-[12px] text-ink-soft">Plex、Emby 上已经有的片子</p>
            </div>
          </SoftLink>
          <SoftLink
            to="/schedule/polls"
            className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 hover:bg-muted"
          >
            <span className="text-[15px]">🗳️</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">观影投票</p>
              <p className="text-[12px] text-ink-soft">今晚看哪部，让家里人投</p>
            </div>
          </SoftLink>
          <SoftLink
            to="/eat/media/history"
            className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 hover:bg-muted"
          >
            <span className="text-[15px]">⏱️</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">观看记录</p>
              <p className="text-[12px] text-ink-soft">{sessions.data?.length ?? 0} 次播放</p>
            </div>
          </SoftLink>
          {/* 观影设置还没搬，先给旧版入口，别让人点空 */}
          {[
            ...(canManage ? [['⚙️', '观影设置', '连接 Plex / Emby / MoviePilot', '/media/settings']] : []),
          ].map(([emoji, title, hint, path]) => (
            <a
              key={path}
              href={legacyUrl(path)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 hover:bg-muted"
            >
              <span className="text-[15px]">{emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">{title}</p>
                <p className="text-[12px] text-ink-soft">{hint} · 还在旧版</p>
              </div>
            </a>
          ))}
        </Panel>

        <Panel title="媒体服务" grow={false}>
          {(connectors.data ?? []).map((connector, index) => (
            <div
              key={connector.key}
              className={
                'flex items-center gap-2 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')
              }
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{connector.name}</p>
                <p className="truncate text-[12px] text-ink-soft">
                  {connector.role === 'library' ? '媒体库' : '自动化'} · {connector.message}
                </p>
              </div>
              <span
                className={
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] ' +
                  (connector.available
                    ? 'bg-accent-soft text-accent'
                    : connector.state === 'needs_credential'
                      ? 'bg-warm-soft text-warm'
                      : 'bg-muted text-ink-soft')
                }
              >
                {MEDIA_CONNECTOR_STATE_LABELS[connector.state] ?? connector.state}
              </span>
            </div>
          ))}
          {connectors.data?.length ? null : (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">还没有媒体服务。</p>
          )}
        </Panel>
      </aside>
    </Page>
  );
}
