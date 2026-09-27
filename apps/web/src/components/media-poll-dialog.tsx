import { useState } from 'react';
import type { HouseholdMedia, HouseholdPoll } from '@family/contracts';
import { useUpsertPoll, useVotePoll } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog } from './ui';

/**
 * 观影投票有两种发起方式：一部片的「看不看」，和几部片里「今晚看哪部」。
 * 后端会把候选片都置成「投票中」，投票结束再落回「想看」——所以这里不用自己改状态。
 */
export function MediaPollDialog({
  entries,
  poll,
  onCreated,
  onClose,
}: {
  entries: HouseholdMedia[];
  poll: HouseholdPoll | null;
  onCreated: () => void;
  onClose: () => void;
}) {
  const upsert = useUpsertPoll();
  const vote = useVotePoll();
  const single = entries.length === 1;
  const [title, setTitle] = useState(
    single ? `要一起看《${entries[0].mediaTitle.title}》吗？` : '这次一起看哪一部？',
  );
  const [picked, setPicked] = useState<string[]>(poll?.selectedOptionIds ?? []);
  const [message, setMessage] = useState<string | null>(null);

  function create() {
    if (!title.trim()) return setMessage('给投票起个标题');
    setMessage(null);
    upsert.mutate(
      {
        body: {
          title: title.trim(),
          description: null,
          category: 'movie',
          voteMode: 'single',
          maxChoices: 1,
          closesAt: null,
          options: single
            ? [{ label: '想看' }, { label: '这次先不看' }]
            : entries.map((entry) => ({ label: entry.mediaTitle.title, mediaId: entry.id })),
          // 单片投票挂在这条片单上，多片选片不挂来源
          ...(single ? { sourceModule: 'media' as const, sourceId: entries[0].id } : {}),
        },
      },
      {
        onSuccess: () => {
          pushToast('投票发起了');
          onCreated();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没发起来'),
      },
    );
  }

  function submitVote() {
    if (!poll) return;
    setMessage(null);
    vote.mutate(
      { id: poll.id, optionIds: picked },
      {
        onSuccess: () => {
          pushToast(picked.length ? '选择记下了' : '撤回了选择');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没投上'),
      },
    );
  }

  const closed = poll ? poll.status !== 'open' || !poll.canVote : false;

  return (
    <Dialog
      title={poll ? '观影投票' : single ? '发起观影投票' : '发起选片投票'}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          {poll ? (
            closed ? (
              <p className="text-center text-[13px] text-ink-soft">这轮投票已经结束了。</p>
            ) : (
              <Button className="w-full" disabled={vote.isPending} onClick={submitVote}>
                {picked.length ? '保存选择' : '撤回选择'}
              </Button>
            )
          ) : (
            <Button className="w-full" disabled={upsert.isPending} onClick={create}>
              {upsert.isPending ? '发起中…' : '发起投票'}
            </Button>
          )}
        </div>
      }
    >
      {poll ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink-soft">
            {poll.title} · {poll.totalVoters} 人参与了
          </p>
          {poll.options.map((option) => {
            const chosen = picked.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={chosen}
                disabled={closed}
                onClick={() => setPicked(chosen ? [] : [option.id])}
                className={
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ' +
                  (chosen ? 'border-accent bg-accent-soft' : 'border-border hover:bg-muted')
                }
              >
                <span className="min-w-0 flex-1 truncate text-[14px]">{option.label}</span>
                <span className="shrink-0 text-[12px] text-ink-soft">
                  {option.voteCount} 票 · {Math.round(option.percentage)}%
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">投票标题</span>
            <input
              value={title}
              maxLength={120}
              aria-label="投票标题"
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div>
            <p className="mb-1 text-[12px] text-ink-soft">候选</p>
            <ul className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
              {single ? (
                <>
                  <li className="text-[13px]">想看</li>
                  <li className="text-[13px]">这次先不看</li>
                </>
              ) : (
                entries.map((entry) => (
                  <li key={entry.id} className="truncate text-[13px]">
                    {entry.mediaTitle.title}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}
