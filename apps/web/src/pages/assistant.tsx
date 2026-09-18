import { Fragment, useEffect, useRef, useState } from 'react';
import type { AgentConversation } from '@family/contracts';
import {
  useAgentConversation,
  useAgentConversations,
  useAgentProposalGroups,
  useAgentStatus,
  useArchiveAgentConversation,
  useCancelAgentRun,
  useCreateAgentConversation,
  useRetryAgentRun,
  useSendAgentMessage,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import {
  MessageBubble,
  ProposalCard,
  ToolProgress,
  ToolResultGroup,
} from '../components/agent-chat';
import { ProposalGroupCard } from '../components/agent-memory-ui';
import { AssistantSettings } from '../components/agent-settings-ui';
import { SoftLink } from '../components/soft-link';
import { Button, EmptyState, Input, Page, Panel } from '../components/ui';

const SUGGESTIONS = [
  '今天三餐吃什么？',
  '这周还有哪些家庭任务？',
  '今天的购物清单还有什么？',
  '最近有哪些东西快没了？',
  '这个月家里花了多少钱？',
];

function when(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function AssistantPage() {
  const { session } = useAuth();
  const status = useAgentStatus();
  const conversations = useAgentConversations();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversation = useAgentConversation(conversationId);
  const create = useCreateAgentConversation();
  const send = useSendAgentMessage();
  const cancel = useCancelAgentRun();
  const retry = useRetryAgentRun();
  const archive = useArchiveAgentConversation();
  const proposalGroups = useAgentProposalGroups(Boolean(conversationId));

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  const rows = conversations.data ?? [];
  // 会话列表回来之后落到第一个；当前这个被归档了也要跟着换
  const [seen, setSeen] = useState<AgentConversation[] | null>(null);
  if (conversations.data && seen !== conversations.data) {
    setSeen(conversations.data);
    if (!conversationId || !rows.some((one) => one.id === conversationId)) {
      setConversationId(rows[0]?.id ?? null);
    }
  }

  const detail = conversation.data;
  const messages = detail?.messages ?? [];
  const activeRun = detail?.runs.find((run) => run.status === 'queued' || run.status === 'running');
  const latestRun = detail?.runs[0] ?? null;
  const busy = send.isPending || create.isPending || Boolean(activeRun);

  // 新消息进来就滚到底
  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, activeRun?.status]);

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    try {
      let id = conversationId;
      if (!id) id = (await create.mutateAsync(undefined)).id;
      setConversationId(id);
      await send.mutateAsync({ conversationId: id, message: text });
      setDraft('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '没发出去，再试一次');
    }
  }

  const runtimeHint = status.data?.selected.available
    ? status.data.runtimeKind === 'hermes'
      ? 'Hermes 已连接'
      : '本地家庭摘要可用'
    : '离线模式可用';

  return (
    <Page
      title="问问小管家"
      subtitle={runtimeHint}
      actions={
        <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="h-9 px-3 text-[13px]"
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </Button>
        <SoftLink
          to="/me/assistant/memories"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted"
        >
          它记住了什么
        </SoftLink>
        <Button
          className="h-9 px-3 text-[13px]"
          disabled={create.isPending}
          onClick={async () => {
            // 这里不清空草稿：草稿属于输入框，不属于某一次会话
            setError(null);
            const created = await create.mutateAsync(undefined);
            setConversationId(created.id);
          }}
        >
          + 新对话
        </Button>
        </div>
      }
    >
      {/* 聊天这块不用 Panel：Panel 会把 children 塞进自己的滚动容器，
          输入框就没法钉在底部了。这里自己排：消息流 flex-1 滚动，输入框贴着下沿。 */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
        <div ref={streamRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4 lg:min-h-[320px]">
          {conversation.isPending && conversationId ? (
            <p className="py-6 text-center text-[13px] text-ink-soft">读取对话…</p>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-3xl">✨</span>
              <p className="text-[17px] font-semibold">想了解家里的什么？</p>
              <p className="max-w-[420px] text-[13px] leading-relaxed text-ink-soft">
                可以问安排、库存、片单，也可以让它先拟一条待确认的事项——写库之前一定会先问你。
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((one) => (
                  <button
                    key={one}
                    type="button"
                    onClick={() => setDraft(one)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink"
                  >
                    {one}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <Fragment key={message.id}>
                  <MessageBubble message={message} />
                  {message.role === 'assistant' && message.runId ? (
                    <ToolResultGroup
                      events={(detail?.toolEvents ?? []).filter(
                        (event) => event.runId === message.runId,
                      )}
                    />
                  ) : null}
                </Fragment>
              ))}

              {conversationId
                ? (proposalGroups.data ?? [])
                    .filter((group) => group.conversationId === conversationId)
                    .map((group) => <ProposalGroupCard key={group.id} group={group} />)
                : null}

              {conversationId
                ? detail?.proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      conversationId={conversationId}
                    />
                  ))
                : null}

              {activeRun ? (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ToolProgress
                      events={(detail?.toolEvents ?? []).filter(
                        (event) => event.runId === activeRun.id,
                      )}
                      queued={activeRun.status === 'queued'}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 px-3 text-[13px] text-danger"
                    disabled={cancel.isPending}
                    onClick={() =>
                      cancel.mutate({ runId: activeRun.id, conversationId: activeRun.conversationId })
                    }
                  >
                    停止
                  </Button>
                </div>
              ) : latestRun && (latestRun.status === 'failed' || latestRun.status === 'cancelled') ? (
                <div aria-live="polite" className="flex items-center gap-2 rounded-card bg-muted/50 px-3.5 py-2.5">
                  <p className="min-w-0 flex-1 text-[13px] text-danger">
                    {latestRun.status === 'cancelled'
                      ? '这次回答已停止。'
                      : (latestRun.errorMessage ?? '回答失败了，你输入的内容还在，可以再发一次。')}
                  </p>
                  {latestRun.retryable && conversationId ? (
                    <Button
                      variant="outline"
                      className="h-8 shrink-0 px-2.5 text-[13px]"
                      disabled={retry.isPending}
                      onClick={() =>
                        retry.mutate({ runId: latestRun.id, conversationId })
                      }
                    >
                      重试
                    </Button>
                  ) : null}
                </div>
              ) : latestRun?.errorCode === 'HERMES_UNAVAILABLE_FALLBACK' ? (
                <p aria-live="polite" className="rounded-card bg-muted/50 px-3.5 py-2.5 text-[13px] text-warm">
                  这次是本地家庭摘要回答的（Hermes 没连上）。
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          {error ? <p className="mb-2 text-[13px] text-danger">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              aria-label="问小管家"
              placeholder="问点什么，比如「今天晚饭吃什么」"
              disabled={!status.data?.enabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              className="h-10 shrink-0 px-4"
              disabled={!draft.trim() || busy || !status.data?.enabled}
              aria-label="发送问题"
              onClick={() => void submit()}
            >
              发送
            </Button>
          </div>
          {status.data && !status.data.enabled ? (
            <p className="mt-2 text-[12px] text-ink-soft">小管家当前没启用，找家庭管理员在设置里打开。</p>
          ) : null}
        </div>
      </section>

      <aside className="flex shrink-0 flex-col lg:w-[280px]">
        <Panel title="最近的对话">
          {conversations.isPending ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">读取中…</p>
          ) : rows.length === 0 ? (
            <EmptyState emoji="💬" title="还没有对话" hint="直接在左边问一句就开始了" />
          ) : (
            rows.map((one, index) => (
              <div
                key={one.id}
                className={
                  'flex items-center gap-2 px-3 py-2.5 ' +
                  (index ? 'border-t border-border ' : '') +
                  (one.id === conversationId ? 'bg-accent-soft/50' : '')
                }
              >
                <button
                  type="button"
                  onClick={() => setConversationId(one.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px] font-medium">{one.title}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-soft">
                    {when(one.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`归档对话${one.title}`}
                  disabled={archive.isPending}
                  onClick={() =>
                    archive.mutate(one.id, { onSuccess: () => pushToast('对话已归档') })
                  }
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </Panel>
      </aside>

      {settingsOpen ? (
        <AssistantSettings
          manager={session?.member.role !== 'member'}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </Page>
  );
}
