import { useState } from 'react';
import type { MediaLibraryItem, MediaType } from '@family/contracts';
import {
  MEDIA_TYPE_LABELS,
  mediaAsset,
  useAddLibraryItemToWatchlist,
  useMediaLibrary,
  useSyncMediaLibrary,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Input, Page, Panel, Segmented } from '../components/ui';

function syncedLabel(value: string | null) {
  if (!value) return '还没同步过';
  return `上次同步 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))}`;
}

/** 海报地址换了就重挂载（调用方用 key={posterUrl} 传），所以这里不用在 effect 里重置。 */
function Poster({ item, className }: { item: MediaLibraryItem; className: string }) {
  const [failed, setFailed] = useState(false);
  const src = mediaAsset(item.posterUrl);

  if (!src || failed) {
    return (
      <span className={`grid shrink-0 place-items-center rounded bg-muted text-xl ${className}`}>
        🎞️
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={`shrink-0 rounded object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

export function MediaLibraryPage() {
  const { session } = useAuth();
  const canManage = session?.member.role !== 'member';

  const [type, setType] = useState<MediaType | 'all'>('all');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MediaLibraryItem | null>(null);

  const library = useMediaLibrary({ type, search, page });
  const sync = useSyncMediaLibrary();
  const add = useAddLibraryItemToWatchlist();

  const data = library.data;
  const items = data?.items ?? [];
  const sources = (data?.connectors ?? []).map((one) => one.name).join(' · ');

  function changeFilter(next: MediaType | 'all') {
    setType(next);
    setPage(1);
  }

  function addToWatchlist(item: MediaLibraryItem) {
    add.mutate(item.id, {
      onSuccess: (result) => {
        setDetail((current) =>
          current && current.id === item.id
            ? { ...current, householdMediaId: result.householdMediaId }
            : current,
        );
        // 后端会回 added：重复加不是新加，说清楚免得人以为加了两遍
        pushToast(result.added ? `「${item.title}」加进片单了` : `「${item.title}」本来就在片单里`);
      },
    });
  }

  return (
    <Page
      title="我的媒体库"
      subtitle={
        <>
          <SoftLink to="/eat/media" className="text-accent hover:underline">
            ← 家庭观影
          </SoftLink>
          {' · '}
          {sources || '家里的媒体服务'}
          {' · '}
          {data ? `${data.total} 部 · ${syncedLabel(data.lastSyncedAt)}` : '正在读'}
        </>
      }
      actions={
        canManage ? (
          <Button
            className="h-9 px-3 text-[13px]"
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(undefined, {
                onSuccess: (result) => {
                  const scanned = result.results.reduce((sum, one) => sum + one.itemCount, 0);
                  const matched = result.results.reduce((sum, one) => sum + one.matchedCount, 0);
                  pushToast(`同步好了 ${scanned} 部，其中 ${matched} 部对上了片单`);
                },
              })
            }
          >
            {sync.isPending ? '同步中…' : '同步'}
          </Button>
        ) : null
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={type}
            onChange={changeFilter}
            options={[
              { value: 'all' as const, label: '全部' },
              { value: 'movie' as const, label: '电影' },
              { value: 'series' as const, label: '剧集' },
            ]}
          />
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              aria-label="搜索媒体库"
              placeholder="搜片名"
              className="h-9 w-[180px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSearch(draft);
                  setPage(1);
                }
              }}
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 px-3 text-[13px]"
              onClick={() => {
                setSearch(draft);
                setPage(1);
              }}
            >
              搜索
            </Button>
          </div>
        </div>
      }
    >
      <Panel className="p-3">
        {library.isPending ? (
          <ListSkeleton rows={4} />
        ) : library.isError ? (
          <EmptyState emoji="🎞️" title="媒体库读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="🎞️"
            title={data?.lastSyncedAt ? '没找到' : '媒体库还没同步过'}
            hint={
              data?.lastSyncedAt
                ? '换个筛选或者关键词试试'
                : canManage
                  ? '点右上角「同步」把 Plex / Emby 里的片子读进来；还没连的话先去观影设置'
                  : '等家庭管理员同步一次'
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  aria-label={item.title}
                  className="flex gap-3 rounded-card border border-border p-3"
                >
                  <Poster key={item.posterUrl ?? item.id} item={item} className="h-[108px] w-[72px]" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="line-clamp-2 text-[14px] font-medium">{item.title}</p>
                    <p className="mt-0.5 text-[12px] text-ink-soft">
                      {MEDIA_TYPE_LABELS[item.type]}
                      {item.year ? ` · ${item.year}` : ''} · {item.connectorName}
                    </p>
                    {item.overview ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-ink-soft">{item.overview}</p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[12px]"
                        aria-label={`看看${item.title}`}
                        onClick={() => setDetail(item)}
                      >
                        详情
                      </Button>
                      {item.playbackUrl ? (
                        <a
                          href={mediaAsset(item.playbackUrl) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`用${item.connectorName}播放${item.title}`}
                          className="inline-flex h-8 items-center rounded-lg px-2 text-[12px] text-ink-soft hover:bg-muted hover:text-ink"
                        >
                          播放
                        </a>
                      ) : null}
                      {item.householdMediaId ? (
                        <SoftLink
                          to={`/eat/media/watchlist?mediaId=${item.householdMediaId}`}
                          className="inline-flex h-8 items-center rounded-lg px-2 text-[12px] text-accent hover:bg-muted"
                        >
                          已在片单
                        </SoftLink>
                      ) : (
                        <Button
                          variant="ghost"
                          className="h-8 px-2 text-[12px]"
                          aria-label={`把${item.title}加进片单`}
                          disabled={add.isPending}
                          onClick={() => addToWatchlist(item)}
                        >
                          加进片单
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {data && data.pages > 1 ? (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  className="h-8 px-2 text-[13px]"
                  aria-label="上一页"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  ‹
                </Button>
                <span className="text-[13px] text-ink-soft">
                  {data.page} / {data.pages}
                </span>
                <Button
                  variant="outline"
                  className="h-8 px-2 text-[13px]"
                  aria-label="下一页"
                  disabled={page >= data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  ›
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {detail ? (
        <Dialog
          title={detail.title}
          maxWidth={640}
          onClose={() => setDetail(null)}
          footer={
            <div className="flex flex-wrap gap-2">
              {detail.playbackUrl ? (
                <a
                  href={mediaAsset(detail.playbackUrl) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm hover:bg-muted"
                >
                  用{detail.connectorName}播放
                </a>
              ) : null}
              {detail.householdMediaId ? (
                <SoftLink
                  to={`/eat/media/watchlist?mediaId=${detail.householdMediaId}`}
                  className="inline-flex h-10 items-center rounded-lg px-4 text-sm text-accent hover:bg-muted"
                >
                  去片单看看
                </SoftLink>
              ) : (
                <Button disabled={add.isPending} onClick={() => addToWatchlist(detail)}>
                  加进家庭片单
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <Poster key={detail.posterUrl ?? detail.id} item={detail} className="h-[168px] w-[112px]" />
              <div className="min-w-0 flex-1">
                {detail.originalTitle && detail.originalTitle !== detail.title ? (
                  <p className="text-[13px] text-ink-soft">{detail.originalTitle}</p>
                ) : null}
                <p className="mt-1 text-[13px] text-ink-soft">
                  {MEDIA_TYPE_LABELS[detail.type]}
                  {detail.year ? ` · ${detail.year}` : ''}
                </p>
                <p className="mt-1 text-[13px] text-ink-soft">来自 {detail.connectorName}</p>
                <p className="mt-1 text-[13px] text-ink-soft">
                  家庭片单：{detail.householdMediaId ? '已加入' : '还没加'}
                </p>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-6">
              {detail.overview || '这部还没有简介。'}
            </p>
            {detail.externalRefs.length ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.externalRefs.map((ref) => (
                  <span
                    key={`${ref.provider}:${ref.externalId}`}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    {ref.provider.toUpperCase()} {ref.externalId}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </Page>
  );
}
