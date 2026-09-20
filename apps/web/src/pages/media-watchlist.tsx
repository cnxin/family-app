import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  HouseholdMedia,
  HouseholdMediaStatus,
  HouseholdPoll,
  MediaRequest,
} from '@family/contracts';
import {
  MEDIA_STATUS_LABELS,
  useCancelMediaRequest,
  useDeleteMedia,
  useMediaConnectors,
  useMediaLibraryAvailability,
  useMediaRequests,
  useMediaWatchlist,
  usePolls,
  useRefreshMediaRequest,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { MediaForm } from '../components/media-form';
import { MediaPollDialog } from '../components/media-poll-dialog';
import { MetadataLinkDialog, SubscriptionDialog } from '../components/media-request-dialogs';
import { MediaWatchlistCard } from '../components/media-watchlist-card';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Input, Page, Panel } from '../components/ui';

type Filter = HouseholdMediaStatus | 'all';

const NO_ENTRIES: HouseholdMedia[] = [];
const POLL_MAX = 12;

export function MediaWatchlistPage() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(
    (params.get('filter') as Filter | null) ?? 'all',
  );
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  const list = useMediaWatchlist(filter, search);
  const rows = list.data ?? NO_ENTRIES;
  const requests = useMediaRequests();
  const connectors = useMediaConnectors();
  const polls = usePolls();
  const availability = useMediaLibraryAvailability(rows.map((one) => one.id));
  const removeEntry = useDeleteMedia();
  const refreshRequest = useRefreshMediaRequest();
  const cancelRequest = useCancelMediaRequest();

  const [editing, setEditing] = useState<HouseholdMedia | null>(null);
  const [composing, setComposing] = useState(false);
  const [removing, setRemoving] = useState<HouseholdMedia | null>(null);
  const [subscribing, setSubscribing] = useState<HouseholdMedia | null>(null);
  const [linking, setLinking] = useState<HouseholdMedia | null>(null);
  const [polling, setPolling] = useState<{ entries: HouseholdMedia[]; poll: HouseholdPoll | null } | null>(
    null,
  );
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // 每条只显示最近更新的那一条订阅
  const requestByMedia = new Map<string, MediaRequest>();
  for (const request of requests.data ?? []) {
    if (!requestByMedia.has(request.householdMediaId)) requestByMedia.set(request.householdMediaId, request);
  }

  // 进行中的投票：单片投票挂 sourceId，选片投票挂在候选项的 mediaId 上
  const pollByMedia = new Map<string, HouseholdPoll>();
  for (const poll of polls.data ?? []) {
    if (poll.status !== 'open') continue;
    if (poll.sourceModule === 'media' && poll.sourceId) pollByMedia.set(poll.sourceId, poll);
    for (const option of poll.options) {
      if (option.mediaId) pollByMedia.set(option.mediaId, poll);
    }
  }

  const moviePilot = (connectors.data ?? []).find((one) => one.kind === 'moviepilot');
  const busy = refreshRequest.isPending || cancelRequest.isPending || removeEntry.isPending;

  // 深链 /media/watchlist?mediaId=… 跳过来，直接把那条的编辑框打开
  const wanted = params.get('mediaId');
  if (wanted && !editing) {
    const hit = rows.find((one) => one.id === wanted);
    if (hit) {
      setEditing(hit);
      setParams({}, { replace: true });
    }
  }

  function toggleSelect(entry: HouseholdMedia) {
    setPicked((current) =>
      current.includes(entry.id)
        ? current.filter((id) => id !== entry.id)
        : current.length >= POLL_MAX
          ? current
          : [...current, entry.id],
    );
  }

  return (
    <Page
      title="家庭片单"
      subtitle={
        <>
          <SoftLink to="/life/media" className="text-accent hover:underline">
            ← 家庭观影
          </SoftLink>
          {' · '}
          {rows.length} 部影视
        </>
      }
      actions={
        selecting ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-ink-soft">选了 {picked.length} 部</span>
            <Button
              variant="ghost"
              className="h-9 px-3 text-[13px]"
              onClick={() => {
                setSelecting(false);
                setPicked([]);
              }}
            >
              算了
            </Button>
            <Button
              className="h-9 px-3 text-[13px]"
              disabled={picked.length < 2}
              onClick={() =>
                setPolling({
                  entries: rows.filter((one) => picked.includes(one.id)),
                  poll: null,
                })
              }
            >
              发起投票
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              className="h-9 px-3 text-[13px]"
              onClick={() => {
                setFilter('all');
                setPicked([]);
                setSelecting(true);
              }}
            >
              挑几部投票
            </Button>
            <Button className="h-9 px-3 text-[13px]" onClick={() => setComposing(true)}>
              + 加进片单
            </Button>
          </div>
        )
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              aria-label="搜索片单"
              placeholder="搜片名"
              className="h-9 w-[160px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSearch(draft);
              }}
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 px-3 text-[13px]"
              onClick={() => setSearch(draft)}
            >
              搜索
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按状态筛选">
            {(['all', ...Object.keys(MEDIA_STATUS_LABELS)] as Filter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                className={
                  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
                  (filter === value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? '全部' : MEDIA_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <Panel className="p-3">
        {list.isPending ? (
          <ListSkeleton rows={4} />
        ) : list.isError ? (
          <EmptyState emoji="🎬" title="片单读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="🎬"
            title={search || filter !== 'all' ? '没有符合条件的' : '片单还是空的'}
            hint="想看什么就先加进来，回头挑一部定个日子"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((entry) => (
              <MediaWatchlistCard
                key={entry.id}
                entry={entry}
                libraries={availability.data?.[entry.id] ?? []}
                request={requestByMedia.get(entry.id) ?? null}
                poll={pollByMedia.get(entry.id) ?? null}
                moviePilotOnline={Boolean(moviePilot?.available)}
                selecting={selecting}
                selected={picked.includes(entry.id)}
                busy={busy}
                onToggleSelect={() => toggleSelect(entry)}
                onEdit={() => setEditing(entry)}
                onRemove={() => setRemoving(entry)}
                onPoll={() => setPolling({ entries: [entry], poll: pollByMedia.get(entry.id) ?? null })}
                onSubscribe={() => setSubscribing(entry)}
                onLinkTmdb={() => setLinking(entry)}
                onRefreshRequest={() => {
                  const request = requestByMedia.get(entry.id);
                  if (request) {
                    refreshRequest.mutate(request.id, {
                      onSuccess: () => pushToast('订阅状态刷新了'),
                    });
                  }
                }}
                onCancelRequest={() => {
                  const request = requestByMedia.get(entry.id);
                  if (request) {
                    cancelRequest.mutate(request.id, {
                      onSuccess: () => pushToast('订阅取消了'),
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
      </Panel>

      {composing || editing ? (
        <MediaForm
          editing={editing}
          onClose={() => {
            setEditing(null);
            setComposing(false);
          }}
        />
      ) : null}

      {subscribing ? (
        <SubscriptionDialog entry={subscribing} onClose={() => setSubscribing(null)} />
      ) : null}

      {linking ? <MetadataLinkDialog entry={linking} onClose={() => setLinking(null)} /> : null}

      {polling ? (
        <MediaPollDialog
          entries={polling.entries}
          poll={polling.poll}
          onCreated={() => {
            setPolling(null);
            setSelecting(false);
            setPicked([]);
            setFilter('voting');
          }}
          onClose={() => setPolling(null)}
        />
      ) : null}

      {removing ? (
        <Dialog
          title="从片单里移出去？"
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemoving(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={busy}
                onClick={() =>
                  removeEntry.mutate(removing.id, {
                    onSuccess: () => {
                      setRemoving(null);
                      pushToast(`「${removing.mediaTitle.title}」移出片单了`);
                    },
                  })
                }
              >
                移出片单
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            「{removing.mediaTitle.title}」会从家庭片单里去掉。要是它还挂着进行中的投票或者订阅，
            后端会拦住，先把那些结束掉再来。
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
