import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HouseholdPoll } from '@family/contracts';
import { useArchivePoll, usePolls, useSetPollStatus } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { PollCard } from '../components/poll-card';
import { PollForm } from '../components/poll-form';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

type Filter = 'open' | 'closed' | 'all';
type Pending = { type: 'close' | 'archive'; poll: HouseholdPoll } | null;

const NO_POLLS: HouseholdPoll[] = [];

export function PollsPage() {
  const polls = usePolls();
  const setStatus = useSetPollStatus();
  const archive = useArchivePoll();
  const [params, setParams] = useSearchParams();
  const focusedId = params.get('pollId');
  const [filter, setFilter] = useState<Filter>('open');
  const [form, setForm] = useState<{ editing: HouseholdPoll | null } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [consumed, setConsumed] = useState<string | null>(null);

  const rows = polls.data ?? NO_POLLS;
  // 从通知 / 日历带 ?pollId= 过来：已结束的要把筛选切到「全部」才看得见；?create=1 直接开表单
  const focused = focusedId ? rows.find((one) => one.id === focusedId) : undefined;
  if (focused && consumed !== focused.id) {
    setConsumed(focused.id);
    if (focused.status === 'closed') setFilter('all');
  }
  if (params.get('create') === '1' && consumed !== 'create') {
    setConsumed('create');
    setForm({ editing: null });
  }

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((one) => one.status === filter)),
    [rows, filter],
  );
  const openCount = rows.filter((one) => one.status === 'open').length;

  const closeForm = () => {
    setForm(null);
    if (params.get('create')) setParams({}, { replace: true });
  };

  return (
    <Page
      title="家庭投票"
      subtitle={openCount ? `${openCount} 个正在进行，需要全家一起决定的事都在这儿` : '需要全家一起决定的事情可以放在这里'}
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setForm({ editing: null })}>
          + 发起投票
        </Button>
      }
      toolbar={
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: `进行中${openCount ? ` ${openCount}` : ''}` },
            { value: 'closed', label: '已结束' },
            { value: 'all', label: '全部' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {polls.isPending ? (
          <ListSkeleton rows={4} />
        ) : polls.isError ? (
          <EmptyState emoji="🗳️" title="投票读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : visible.length === 0 ? (
          <EmptyState
            emoji="🗳️"
            title={filter === 'open' ? '现在没有进行中的投票' : '没有这样的投票'}
            hint="周末去哪儿、晚上吃什么，发个投票让大家选"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
            {visible.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                focused={poll.id === focusedId}
                onEdit={() => setForm({ editing: poll })}
                onClose={() => setPending({ type: 'close', poll })}
                onReopen={() =>
                  setStatus.mutate(
                    { id: poll.id, action: 'reopen' },
                    { onSuccess: () => pushToast(`「${poll.title}」重新开放投票`) },
                  )
                }
                onArchive={() => setPending({ type: 'archive', poll })}
              />
            ))}
          </div>
        )}
      </Panel>

      {form ? (
        <PollForm
          key={form.editing?.id ?? 'new'}
          poll={form.editing}
          onClose={closeForm}
          onSaved={(saved) => {
            closeForm();
            if (saved.status === 'closed') setFilter('all');
            setParams({ pollId: saved.id }, { replace: true });
          }}
        />
      ) : null}

      {pending ? (
        <Dialog
          title={pending.type === 'close' ? '结束这个投票？' : '删除这个投票？'}
          onClose={() => setPending(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPending(null)}>
                再想想
              </Button>
              <Button
                className={'flex-1 ' + (pending.type === 'archive' ? 'bg-danger hover:brightness-110' : '')}
                disabled={setStatus.isPending || archive.isPending}
                onClick={() => {
                  const { poll } = pending;
                  const done = () => {
                    setPending(null);
                    pushToast(pending.type === 'close' ? `「${poll.title}」已结束` : `「${poll.title}」已删除`);
                  };
                  if (pending.type === 'close') {
                    setStatus.mutate({ id: poll.id, action: 'close' }, { onSuccess: done });
                  } else {
                    archive.mutate(poll.id, { onSuccess: done });
                  }
                }}
              >
                {pending.type === 'close' ? '结束投票' : '删除投票'}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">
            {pending.type === 'close'
              ? '结束后大家就不能再投或改票了，结果会留在「已结束」里；想反悔可以重新开启。'
              : '删除后大家都看不到这个投票和结果了，这一步不能撤销。'}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
