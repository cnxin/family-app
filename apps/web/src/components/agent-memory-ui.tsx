import { useState } from 'react';
import type {
  AgentMemoryConfidenceSource,
  AgentMemoryItem,
  AgentMemoryKey,
  AgentProposalGroup,
} from '@family/contracts';
import { AGENT_MEMORY_KEYS } from '@family/contracts';
import {
  useConfirmAgentMemory,
  useConfirmAgentProposalGroup,
  useCorrectAgentMemory,
  useCreateMemoryCandidate,
  useForgetAgentMemory,
  useRejectAgentProposalGroup,
  useShareAgentMemory,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

export const MEMORY_KEY_LABEL: Record<AgentMemoryKey, string> = {
  diet_restriction: '饮食限制',
  spice_level: '口味偏好',
  cooking_skill: '厨艺能力',
  schedule_preference: '日程偏好',
  reply_style: '回复方式',
  other: '其他信息',
};

export const MEMORY_KEY_ICON: Record<AgentMemoryKey, string> = {
  diet_restriction: '🥗',
  spice_level: '🌶️',
  cooking_skill: '👨‍🍳',
  schedule_preference: '📅',
  reply_style: '💬',
  other: '💡',
};

const CONFIDENCE_LABEL: Record<AgentMemoryConfidenceSource, string> = {
  explicit: '你确认过',
  business: '来自家里的记录',
  summary_candidate: '从对话里推测',
};

function memoryDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value));
}

const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-ink-soft hover:bg-muted');

export function MemoryCard({ item, onOpen }: { item: AgentMemoryItem; onOpen: () => void }) {
  const candidate = item.status === 'candidate';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${candidate ? '待确认，' : ''}${MEMORY_KEY_LABEL[item.memoryKey] ?? item.category}：${item.content ?? '暂无正文'}`}
      className={
        'flex w-full items-start gap-3 rounded-card border px-3.5 py-3 text-left transition-colors duration-150 ' +
        (candidate ? 'border-accent/40 bg-accent-soft/40 hover:bg-accent-soft/60' : 'border-border bg-surface hover:bg-muted')
      }
    >
      <span className="text-[17px]">{MEMORY_KEY_ICON[item.memoryKey] ?? '💡'}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] text-ink-soft">
            {MEMORY_KEY_LABEL[item.memoryKey] ?? item.category}
          </span>
          {candidate ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">
              待确认
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block line-clamp-2 text-[14px]">{item.content ?? '暂无正文'}</span>
        <span className="mt-1 block text-[12px] text-ink-soft">
          {memoryDate(item.validFrom ?? item.createdAt)} · {CONFIDENCE_LABEL[item.confidenceSource]}
        </span>
      </span>
      <span className="shrink-0 text-ink-soft">›</span>
    </button>
  );
}

/** 一条记忆的详情：确认、共享到家庭、改内容、忘掉。共享过来的只有创建者能动。 */
export function MemoryDetail({
  item,
  meId,
  onClose,
}: {
  item: AgentMemoryItem;
  meId: string | undefined;
  onClose: () => void;
}) {
  const confirm = useConfirmAgentMemory();
  const share = useShareAgentMemory();
  const correct = useCorrectAgentMemory();
  const forget = useForgetAgentMemory();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content ?? '');
  const [memoryKey, setMemoryKey] = useState<AgentMemoryKey>(item.memoryKey);
  const [message, setMessage] = useState<string | null>(null);

  const mine = item.ownerMemberId === meId;
  const busy = confirm.isPending || share.isPending || correct.isPending || forget.isPending;
  const onError = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : '没成功，刷新一下再试');
  const done = (text: string) => () => {
    pushToast(text);
    onClose();
  };

  return (
    <Dialog
      title={MEMORY_KEY_LABEL[item.memoryKey] ?? item.category}
      onClose={onClose}
      maxWidth={460}
      footer={
        editing ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button
              className="flex-1"
              disabled={busy || !content.trim()}
              onClick={() =>
                correct.mutate(
                  {
                    id: item.id,
                    expectedVersion: item.version,
                    content: content.trim(),
                    memoryKey,
                  },
                  { onSuccess: done('记忆已更新'), onError },
                )
              }
            >
              保存修改
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {message ? <p className="text-[13px] text-danger">{message}</p> : null}
            <div className="flex flex-wrap gap-2">
              {item.status === 'candidate' && mine ? (
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    confirm.mutate(
                      { id: item.id, expectedVersion: item.version },
                      { onSuccess: done('记忆已确认，小管家需要时会用到'), onError },
                    )
                  }
                >
                  确认
                </Button>
              ) : null}
              {mine ? (
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setEditing(true)}>
                  改内容
                </Button>
              ) : null}
              {mine && item.scope === 'member_private' ? (
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    share.mutate(
                      { id: item.id, expectedVersion: item.version },
                      { onSuccess: done('已共享到家庭'), onError },
                    )
                  }
                >
                  共享到家庭
                </Button>
              ) : null}
              {mine ? (
                <Button
                  variant="ghost"
                  className="flex-1 text-danger"
                  disabled={busy}
                  onClick={() =>
                    forget.mutate(
                      { id: item.id, expectedVersion: item.version },
                      { onSuccess: done('已忘掉这条'), onError },
                    )
                  }
                >
                  忘掉
                </Button>
              ) : null}
            </div>
          </div>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">内容</span>
            <textarea
              autoFocus
              value={content}
              rows={4}
              maxLength={2000}
              aria-label="记忆内容"
              onChange={(event) => setContent(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <div>
            <span className="mb-1 block text-[12px] text-ink-soft">归到哪一类</span>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_MEMORY_KEYS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={memoryKey === value}
                  className={chip(memoryKey === value)}
                  onClick={() => setMemoryKey(value)}
                >
                  {MEMORY_KEY_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{item.content ?? '暂无正文'}</p>
          <dl className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px]">
            <div className="flex gap-2">
              <dt className="w-[70px] shrink-0 text-ink-soft">可见范围</dt>
              <dd>{item.scope === 'member_private' ? '只有自己看得到' : '家庭共享'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-[70px] shrink-0 text-ink-soft">来源</dt>
              <dd>{CONFIDENCE_LABEL[item.confidenceSource]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-[70px] shrink-0 text-ink-soft">记录时间</dt>
              <dd>{memoryDate(item.validFrom ?? item.createdAt)}</dd>
            </div>
          </dl>
          {mine ? null : (
            <p className="text-[12px] text-ink-soft">这条是家里人共享的，只有记下它的人能改或忘掉。</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AddMemoryForm({ onClose }: { onClose: () => void }) {
  const create = useCreateMemoryCandidate();
  const [content, setContent] = useState('');
  const [memoryKey, setMemoryKey] = useState<AgentMemoryKey>('other');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Dialog
      title="记一条给小管家"
      onClose={onClose}
      maxWidth={440}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button
            className="w-full"
            disabled={!content.trim() || create.isPending}
            onClick={() =>
              create.mutate(
                { content: content.trim(), memoryKey, kind: 'preference' },
                {
                  onSuccess: () => {
                    pushToast('记下了，在「待确认」里点一下确认就生效');
                    onClose();
                  },
                  onError: (error) =>
                    setMessage(error instanceof Error ? error.message : '没记上，再试一次'),
                },
              )
            }
          >
            {create.isPending ? '保存中…' : '记下来'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-soft">想让小管家记住什么</span>
          <Input
            autoFocus
            value={content}
            maxLength={2000}
            aria-label="想让小管家记住什么"
            placeholder="比如：我不吃香菜"
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <div>
          <span className="mb-1 block text-[12px] text-ink-soft">归到哪一类</span>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_MEMORY_KEYS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={memoryKey === value}
                className={chip(memoryKey === value)}
                onClick={() => setMemoryKey(value)}
              >
                {MEMORY_KEY_LABEL[value]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[12px] text-ink-soft">
          记下来之后是「待确认」，你再点一次确认它才会被小管家使用。
        </p>
      </div>
    </Dialog>
  );
}

const GROUP_STATUS_LABEL: Record<AgentProposalGroup['status'], string> = {
  pending: '需要确认',
  // 组确认后就是 confirmed，步骤各自的 executed 在下面每一行上显示
  confirmed: '已确认并执行',
  rejected: '已放弃',
  expired: '已过期',
  failed: '执行中断',
};

/** 多步骤提案组：一次确认，后端按顺序执行，中间断了会停住并标出来。 */
export function ProposalGroupCard({ group }: { group: AgentProposalGroup }) {
  const confirm = useConfirmAgentProposalGroup();
  const reject = useRejectAgentProposalGroup();
  const [message, setMessage] = useState<string | null>(null);
  const busy = confirm.isPending || reject.isPending;
  const onError = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : '没成功，刷新一下再试');

  return (
    <article
      aria-label={`${group.title}多步骤提案`}
      className="rounded-card border border-border bg-surface p-3.5"
    >
      <p className={'text-[12px] font-medium ' + (group.status === 'failed' ? 'text-danger' : group.status === 'pending' ? 'text-warm' : 'text-ink-soft')}>
        多步骤提案 · {GROUP_STATUS_LABEL[group.status]} · 共 {group.steps.length} 步
      </p>
      <h3 className="mt-1 text-[15px] font-semibold">{group.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{group.summary}</p>

      <ol className="mt-2.5 flex flex-col gap-1.5">
        {[...group.steps]
          .sort((left, right) => left.stepOrder - right.stepOrder)
          .map((step) => (
            <li key={step.id} className="flex gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
              <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                {step.stepOrder + 1}.
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{step.preview.title}</span>
                <span className="mt-0.5 block text-[12px] text-ink-soft">{step.preview.summary}</span>
                {step.status === 'failed' && step.failureMessage ? (
                  <span className="mt-0.5 block text-[12px] text-danger">{step.failureMessage}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[12px] text-ink-soft">
                {step.status === 'executed' ? '✓' : step.status === 'failed' ? '×' : ''}
              </span>
            </li>
          ))}
      </ol>

      {message ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {message}
        </p>
      ) : null}

      {group.status === 'pending' ? (
        <div className="mt-3 flex gap-2">
          <Button
            className="h-9 flex-1 px-3 text-[13px]"
            disabled={busy}
            aria-label={`确认${group.title}`}
            onClick={() =>
              confirm.mutate({ id: group.id, expectedVersion: group.version }, { onError })
            }
          >
            {confirm.isPending ? '执行中…' : `确认这 ${group.steps.length} 步`}
          </Button>
          <Button
            variant="outline"
            className="h-9 flex-1 px-3 text-[13px]"
            disabled={busy}
            aria-label={`放弃${group.title}`}
            onClick={() =>
              reject.mutate({ id: group.id, expectedVersion: group.version }, { onError })
            }
          >
            放弃
          </Button>
        </div>
      ) : null}
    </article>
  );
}
