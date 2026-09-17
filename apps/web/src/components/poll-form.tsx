import { useState } from 'react';
import type { HouseholdPoll, PollCategory, PollVoteMode } from '@family/contracts';
import { POLL_CATEGORIES } from '@family/contracts';
import { useUpsertPoll } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

export const POLL_CATEGORY_LABEL: Record<PollCategory, string> = {
  general: '家庭',
  meal: '吃什么',
  activity: '活动',
  movie: '观影',
  shopping: '采购',
};
export const POLL_CATEGORY_ICON: Record<PollCategory, string> = {
  general: '🏠',
  meal: '🍽️',
  activity: '⛺',
  movie: '🎬',
  shopping: '🛒',
};

function twoDaysLater() {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date;
}
function dateOf(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function timeOf(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

/**
 * 发起 / 编辑家庭投票。规则照旧客户端 polls.tsx 的 PollForm：
 * 有人投过票（或候选项是片单条目）之后，只能改标题、说明、分类和截止时间，
 * 候选项和单多选锁死——否则已投的票就对不上了。
 */
export function PollForm({ poll, onClose, onSaved }: {
  poll: HouseholdPoll | null;
  onClose: () => void;
  onSaved: (saved: HouseholdPoll) => void;
}) {
  const save = useUpsertPoll();
  const rulesLocked = Boolean(poll && (poll.totalVotes > 0 || poll.options.some((one) => one.mediaId)));
  const [title, setTitle] = useState(poll?.title ?? '');
  const [description, setDescription] = useState(poll?.description ?? '');
  const [category, setCategory] = useState<PollCategory>(poll?.category ?? 'general');
  const [voteMode, setVoteMode] = useState<PollVoteMode>(poll?.voteMode ?? 'single');
  const [maxChoices, setMaxChoices] = useState(String(poll?.maxChoices ?? 2));
  const [hasDeadline, setHasDeadline] = useState(Boolean(poll?.closesAt));
  const [closesOn, setClosesOn] = useState(dateOf(poll?.closesAt ? new Date(poll.closesAt) : twoDaysLater()));
  const [closesTime, setClosesTime] = useState(poll?.closesAt ? timeOf(new Date(poll.closesAt)) : '20:00');
  const [options, setOptions] = useState<string[]>(poll?.options.map((one) => one.label) ?? ['', '']);
  const [message, setMessage] = useState<string | null>(null);

  const label = 'mb-1 block text-[12px] text-ink-soft';
  const chip = (active: boolean) =>
    'rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ' +
    (active ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-border text-ink-soft hover:bg-muted');

  function submit() {
    const normalizedTitle = title.trim();
    const normalizedOptions = options.map((one) => one.trim()).filter(Boolean);
    const max = voteMode === 'single' ? 1 : Number(maxChoices);
    if (!normalizedTitle) return setMessage('先给投票起个标题');
    if (!rulesLocked && normalizedOptions.length < 2) return setMessage('至少要两个候选项');
    if (
      !rulesLocked &&
      new Set(normalizedOptions.map((one) => one.toLocaleLowerCase('zh-CN'))).size !== normalizedOptions.length
    ) {
      return setMessage('候选项不能重复');
    }
    if (!rulesLocked && voteMode === 'multiple' && (!Number.isInteger(max) || max < 2 || max > normalizedOptions.length)) {
      return setMessage('多选数量要在 2 和候选项总数之间');
    }
    let closesAt: string | null = null;
    if (hasDeadline) {
      const deadline = new Date(`${closesOn}T${closesTime}:00`);
      if (Number.isNaN(deadline.getTime())) return setMessage('截止时间没填对');
      if (deadline.getTime() <= Date.now()) return setMessage('截止时间得晚于现在');
      closesAt = deadline.toISOString();
    }
    setMessage(null);
    save.mutate(
      {
        id: poll?.id,
        body: {
          title: normalizedTitle,
          description: description.trim() || null,
          category,
          closesAt,
          ...(rulesLocked
            ? {}
            : { voteMode, maxChoices: max, options: normalizedOptions.map((one) => ({ label: one })) }),
        },
      },
      {
        onSuccess: (saved) => {
          pushToast(poll ? '投票已更新' : `投票「${saved.title}」已发起`);
          onSaved(saved);
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={poll ? '编辑投票' : '发起投票'}
      onClose={onClose}
      maxWidth={560}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : poll ? '保存修改' : '发起投票'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>标题</span>
          <Input
            autoFocus
            value={title}
            placeholder="比如：周末去哪儿"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>说明（选填）</span>
          <textarea
            value={description}
            rows={2}
            placeholder="预算、时间或需要一起考虑的条件"
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>

        <div>
          <span className={label}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {POLL_CATEGORIES.map((value) => (
              <button key={value} type="button" aria-pressed={category === value} className={chip(category === value)} onClick={() => setCategory(value)}>
                {POLL_CATEGORY_ICON[value]} {POLL_CATEGORY_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {rulesLocked ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-ink-soft">
            已经有人投票了，候选项和单多选不能再改，只能改标题、说明和截止时间。
          </p>
        ) : (
          <>
            <div>
              <span className={label}>怎么选</span>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={voteMode === 'single'} className={chip(voteMode === 'single')} onClick={() => setVoteMode('single')}>
                  单选
                </button>
                <button type="button" aria-pressed={voteMode === 'multiple'} className={chip(voteMode === 'multiple')} onClick={() => setVoteMode('multiple')}>
                  多选
                </button>
                {voteMode === 'multiple' ? (
                  <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                    最多选
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={2}
                      max={12}
                      aria-label="最多可选项数"
                      value={maxChoices}
                      onChange={(event) => setMaxChoices(event.target.value)}
                      className="h-8 w-16 text-center"
                    />
                    项
                  </label>
                ) : null}
              </div>
            </div>

            <div>
              <span className={label}>候选项（2～12 个）</span>
              <div className="flex flex-col gap-1.5">
                {options.map((value, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <Input
                      value={value}
                      aria-label={`候选项 ${index + 1}`}
                      placeholder={`候选项 ${index + 1}`}
                      onChange={(event) =>
                        setOptions((current) => current.map((one, i) => (i === index ? event.target.value : one)))
                      }
                    />
                    {options.length > 2 ? (
                      <button
                        type="button"
                        aria-label={`删除候选项 ${index + 1}`}
                        onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
                {options.length < 12 ? (
                  <Button variant="ghost" className="h-9 self-start px-2 text-[13px]" onClick={() => setOptions((current) => [...current, ''])}>
                    + 再加一个
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}

        <button
          type="button"
          role="checkbox"
          aria-checked={hasDeadline}
          onClick={() => setHasDeadline((value) => !value)}
          className={
            'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ' +
            (hasDeadline ? 'border-accent bg-accent-soft' : 'border-border hover:bg-muted')
          }
        >
          <span className={hasDeadline ? 'text-accent' : 'text-ink-soft'}>{hasDeadline ? '☑' : '☐'}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">设截止时间</span>
            <span className="mt-0.5 block text-[12px] text-ink-soft">到点自动结束，不设就一直开着</span>
          </span>
        </button>
        {hasDeadline ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>截止日期</span>
              <Input type="date" value={closesOn} onChange={(event) => setClosesOn(event.target.value)} />
            </label>
            <label className="block">
              <span className={label}>截止时间</span>
              <Input type="time" value={closesTime} onChange={(event) => setClosesTime(event.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
