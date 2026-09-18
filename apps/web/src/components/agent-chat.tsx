import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AgentActionProposal,
  AgentMessage,
  AgentToolEvent,
  AgentToolPresentation,
} from '@family/contracts';
import { useConfirmAgentProposal, useRejectAgentProposal } from '../lib/queries';
import { legacyUrl } from '../lib/nav';
import { toNewRoute } from '../lib/routes';
import { Button } from './ui';

/** 工具名 → 人话。小管家在查什么，得让家里人看得懂。 */
const TOOL_LABEL: Record<string, string> = {
  get_today_summary: '汇总今日安排',
  get_calendar: '查看家庭日历',
  get_tasks: '查看家庭任务',
  get_shopping_list: '查看购物清单',
  get_meal_plan: '查看菜单安排',
  get_inventory_alerts: '检查库存提醒',
  search_knowledge: '搜索家庭知识库',
  get_travel_checklist: '查看出行清单',
  get_watch_candidates: '查看家庭片单',
  get_recent_memories: '查看家庭回忆',
  get_asset_detail: '查看资产详情',
  get_finance_summary: '查看家庭财务',
  propose_finance_transaction: '生成记账提案',
};

export function MessageBubble({ message }: { message: AgentMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={'flex gap-2 ' + (mine ? 'justify-end' : 'items-start')}>
      {mine ? null : (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[14px]">
          ✨
        </span>
      )}
      <div
        className={
          'max-w-[min(680px,84%)] whitespace-pre-wrap rounded-card px-3.5 py-2.5 text-[14px] leading-relaxed ' +
          (mine ? 'bg-accent text-white' : 'border border-border bg-surface')
        }
      >
        {message.content}
      </div>
    </div>
  );
}

/** 跑着的时候顶在消息流下面：正在查什么、查到哪一步了。 */
export function ToolProgress({ events, queued }: { events: AgentToolEvent[]; queued: boolean }) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-card border border-border bg-muted/50 px-3.5 py-2.5"
    >
      <span className="size-3 shrink-0 animate-pulse rounded-full bg-accent" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">小管家正在处理</p>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {events.length
            ? events
                .map(
                  (event) =>
                    `${event.status === 'failed' ? '未完成' : '已完成'}${TOOL_LABEL[event.toolName] ?? '家庭资料查询'}`,
                )
                .join(' · ')
            : queued
              ? '正在准备回答'
              : '正在查询家庭资料'}
        </p>
      </div>
    </div>
  );
}

function useOpenTarget() {
  const navigate = useNavigate();
  return (targetPath: string) => {
    const route = toNewRoute(targetPath);
    if (route) navigate(route);
    else window.open(legacyUrl(targetPath), '_blank', 'noopener');
  };
}

function ToolResultCard({ presentation }: { presentation: AgentToolPresentation }) {
  const open = useOpenTarget();
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <button
        type="button"
        onClick={() => open(presentation.targetPath)}
        aria-label={`打开${presentation.title}`}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-muted"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{presentation.title}</span>
          <span className="mt-0.5 block text-[12px] text-ink-soft">来自家里的实时数据</span>
        </span>
        <span className="shrink-0 text-ink-soft">›</span>
      </button>
      {presentation.items.length ? (
        <div className="border-t border-border">
          {presentation.items.map((item) => (
            <button
              key={`${presentation.kind}:${item.id}`}
              type="button"
              onClick={() => open(item.targetPath)}
              aria-label={`打开${item.title}`}
              className="flex w-full items-center gap-2 border-b border-border px-3.5 py-2 text-left transition-colors duration-150 last:border-b-0 hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{item.title}</span>
                {item.detail ? (
                  <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-soft">
                    {item.detail}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[12px] text-accent">{item.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ToolResultGroup({ events }: { events: AgentToolEvent[] }) {
  const presentations = events.flatMap((event) => (event.presentation ? [event.presentation] : []));
  if (!presentations.length) return null;
  return (
    <div className="ml-9 flex flex-col gap-2">
      {presentations.map((presentation, index) => (
        <ToolResultCard key={`${presentation.kind}:${index}`} presentation={presentation} />
      ))}
    </div>
  );
}

const PROPOSAL_STATUS: Record<
  AgentActionProposal['status'],
  { label: string; tone: string }
> = {
  pending: { label: '需要确认', tone: 'text-warm' },
  confirmed: { label: '正在执行', tone: 'text-ink-soft' },
  executed: { label: '已确认并执行', tone: 'text-accent' },
  rejected: { label: '已放弃', tone: 'text-ink-soft' },
  expired: { label: '已过期', tone: 'text-ink-soft' },
  failed: { label: '执行失败', tone: 'text-danger' },
};

/**
 * 一条待确认的操作提案。小管家不直接写库：先给出「要改什么」，家里人点确认才落库，
 * 确认带乐观锁和幂等键，所以连点两下也只会执行一次。
 */
export function ProposalCard({
  proposal,
  conversationId,
}: {
  proposal: AgentActionProposal;
  conversationId: string;
}) {
  const confirm = useConfirmAgentProposal();
  const reject = useRejectAgentProposal();
  const open = useOpenTarget();
  const [message, setMessage] = useState<string | null>(null);
  const busy = confirm.isPending || reject.isPending;
  const state = PROPOSAL_STATUS[proposal.status];

  function act(action: 'confirm' | 'reject') {
    setMessage(null);
    const input = { id: proposal.id, conversationId, expectedVersion: proposal.version };
    const onError = (error: unknown) =>
      setMessage(error instanceof Error ? error.message : '没成功，刷新一下再试');
    if (action === 'confirm') confirm.mutate(input, { onError });
    else reject.mutate(input, { onError });
  }

  return (
    <article
      aria-label={`${proposal.actionLabel}操作提案`}
      className="rounded-card border border-border bg-surface p-3.5"
    >
      <p className={'text-[12px] font-medium ' + state.tone}>操作提案 · {state.label}</p>
      <h3 className="mt-1 text-[15px] font-semibold">{proposal.preview.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{proposal.preview.summary}</p>

      <dl className="mt-2.5 flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2.5">
        {proposal.preview.changes.map((change) => (
          <div key={`${change.label}:${change.value}`} className="flex gap-2 text-[13px]">
            <dt className="w-[70px] shrink-0 text-ink-soft">{change.label}</dt>
            <dd className="min-w-0 flex-1">{change.value}</dd>
          </div>
        ))}
      </dl>

      {proposal.preview.warning ? (
        <p className="mt-2 text-[12px] text-warm">{proposal.preview.warning}</p>
      ) : null}
      {proposal.status === 'failed' && proposal.failureMessage ? (
        <p aria-live="polite" className="mt-2 text-[13px] text-danger">
          {proposal.failureMessage}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {message}
        </p>
      ) : null}

      {proposal.status === 'pending' ? (
        <div className="mt-3 flex gap-2">
          <Button
            className="h-9 flex-1 px-3 text-[13px]"
            disabled={busy}
            aria-label={`确认${proposal.preview.title}`}
            onClick={() => act('confirm')}
          >
            {confirm.isPending ? '执行中…' : '确认并执行'}
          </Button>
          <Button
            variant="outline"
            className="h-9 flex-1 px-3 text-[13px]"
            disabled={busy}
            aria-label={`放弃${proposal.preview.title}`}
            onClick={() => act('reject')}
          >
            放弃
          </Button>
        </div>
      ) : proposal.status === 'executed' ? (
        <Button
          variant="outline"
          className="mt-3 h-9 px-3 text-[13px]"
          onClick={() => open(proposal.preview.targetPath)}
        >
          去看看 →
        </Button>
      ) : null}
    </article>
  );
}
