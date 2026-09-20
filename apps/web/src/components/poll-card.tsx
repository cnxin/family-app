import { useState } from 'react';
import type { HouseholdPoll } from '@family/contracts';
import { useVotePoll } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { SoftLink } from './soft-link';
import { Button } from './ui';
import { POLL_CATEGORY_ICON, POLL_CATEGORY_LABEL } from './poll-form';

function sameSelection(left: string[], right: string[]) {
  return [...left].sort().join(',') === [...right].sort().join(',');
}

export function formatDeadline(value: string | null) {
  if (!value) return '不设截止';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * 一张投票卡：选项即投票区，选完点「提交选择」才写库；已投的可以改、也可以撤（清空后提交）。
 * 管理动作（编辑 / 结束 / 重开 / 删除）由页面拿去做确认，卡片只负责发信号。
 */
export function PollCard({
  poll,
  focused,
  onEdit,
  onClose,
  onReopen,
  onArchive,
}: {
  poll: HouseholdPoll;
  focused: boolean;
  onEdit: () => void;
  onClose: () => void;
  onReopen: () => void;
  onArchive: () => void;
}) {
  const vote = useVotePoll();
  const [selected, setSelected] = useState(poll.selectedOptionIds);
  const [seen, setSeen] = useState(poll.selectedOptionIds);
  const [hint, setHint] = useState<string | null>(null);
  // 服务端的选择变了（别处改票、重开）就跟着重置本地选择——渲染期对比，不用 effect
  if (seen !== poll.selectedOptionIds) {
    setSeen(poll.selectedOptionIds);
    setSelected(poll.selectedOptionIds);
  }
  const changed = !sameSelection(selected, poll.selectedOptionIds);
  const open = poll.status === 'open';

  function toggle(optionId: string) {
    if (!poll.canVote) return;
    setHint(null);
    if (poll.voteMode === 'single') {
      setSelected(selected.includes(optionId) ? [] : [optionId]);
      return;
    }
    if (selected.includes(optionId)) {
      setSelected(selected.filter((id) => id !== optionId));
      return;
    }
    if (selected.length >= poll.maxChoices) {
      setHint(`最多只能选 ${poll.maxChoices} 项，先取消一个再选`);
      return;
    }
    setSelected([...selected, optionId]);
  }

  function submit() {
    vote.mutate(
      { id: poll.id, optionIds: selected },
      {
        onSuccess: () => pushToast(selected.length ? '投票已提交，还能再改' : '已撤回你的选择'),
        onError: (error) => setHint(error instanceof Error ? error.message : '投票没成功'),
      },
    );
  }

  return (
    <article
      aria-label={poll.title}
      className={
        'flex flex-col overflow-hidden rounded-card border border-border bg-surface transition-shadow duration-300 ' +
        (focused ? 'ring-2 ring-accent/50' : '')
      }
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-[17px]">
          {POLL_CATEGORY_ICON[poll.category]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold leading-tight">{poll.title}</h3>
            <span
              className={
                'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                (open ? 'bg-accent-soft text-accent' : 'bg-muted text-ink-soft')
              }
            >
              {open ? '进行中' : '已结束'}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {POLL_CATEGORY_LABEL[poll.category]} · {poll.voteMode === 'single' ? '单选' : `最多选 ${poll.maxChoices} 项`} ·{' '}
            {formatDeadline(poll.closesAt)} · {poll.totalVoters} 人参与
          </p>
          {poll.description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{poll.description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-col" role={poll.voteMode === 'single' ? 'radiogroup' : 'group'} aria-label={`${poll.title}的候选项`}>
        {poll.options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role={poll.voteMode === 'single' ? 'radio' : 'checkbox'}
              aria-checked={active}
              aria-label={`${active ? '取消选择' : '选择'}${option.label}`}
              disabled={!poll.canVote}
              onClick={() => toggle(option.id)}
              className={
                'relative flex items-center gap-3 border-t border-border px-4 py-2.5 text-left transition-colors duration-150 ' +
                'disabled:cursor-default ' +
                (active ? 'bg-accent-soft/60' : poll.canVote ? 'hover:bg-muted' : '')
              }
            >
              <span
                aria-hidden
                className={
                  'grid size-5 shrink-0 place-items-center border text-[11px] transition-colors duration-150 ' +
                  (poll.voteMode === 'single' ? 'rounded-full ' : 'rounded-[5px] ') +
                  (active ? 'border-accent bg-accent text-white' : 'border-ink-soft/40 bg-surface')
                }
              >
                {active ? '✓' : ''}
              </span>
              {option.media?.mediaTitle.posterUrl ? (
                <img src={option.media.mediaTitle.posterUrl} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{option.label}</span>
                {option.description ? (
                  <span className="block truncate text-[12px] text-ink-soft">{option.description}</span>
                ) : null}
                {option.voters.length ? (
                  <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                    {option.voters.map((member) => `${member.avatarEmoji} ${member.name}`).join('  ')}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                {option.voteCount} 票 · {option.percentage}%
              </span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 bg-accent/60 transition-[width] duration-500"
                style={{ width: `${option.percentage}%` }}
              />
            </button>
          );
        })}
      </div>

      {hint ? <p className="px-4 pt-2 text-[12px] text-warm">{hint}</p> : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2.5">
        {poll.canVote ? (
          <Button
            className="h-9 px-3 text-[13px]"
            variant={changed ? 'primary' : 'outline'}
            disabled={!changed || vote.isPending}
            onClick={submit}
          >
            {vote.isPending
              ? '提交中…'
              : selected.length || !poll.selectedOptionIds.length
                ? '提交选择'
                : '撤回选择'}
          </Button>
        ) : (
          <span className="px-1 text-[12px] text-ink-soft">{open ? '这个投票你不能参与' : '投票已结束'}</span>
        )}
        <SoftLink
          to={`/schedule/reminders?sourceModule=poll&sourceId=${poll.id}`}
          className="h-9 rounded-lg px-2 text-[13px] leading-9 text-ink-soft transition-colors duration-150 hover:bg-muted"
        >
          🔔 提醒
        </SoftLink>
        {poll.sourceModule === 'media' && poll.sourceId ? (
          <SoftLink
            to={`/life/media/watchlist?mediaId=${poll.sourceId}`}
            className="h-9 rounded-lg px-2 text-[13px] leading-9 text-ink-soft transition-colors duration-150 hover:bg-muted"
          >
            🎬 看片单
          </SoftLink>
        ) : null}
        {poll.canManage ? (
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" className="h-9 px-2 text-[13px]" aria-label={`编辑投票${poll.title}`} onClick={onEdit}>
              编辑
            </Button>
            <Button
              variant="ghost"
              className="h-9 px-2 text-[13px]"
              aria-label={open ? `结束投票${poll.title}` : `重新开启投票${poll.title}`}
              onClick={open ? onClose : onReopen}
            >
              {open ? '结束' : '重新开启'}
            </Button>
            <Button variant="ghost" className="h-9 px-2 text-[13px] text-ink-soft" aria-label={`删除投票${poll.title}`} onClick={onArchive}>
              删除
            </Button>
          </span>
        ) : null}
      </div>
    </article>
  );
}
