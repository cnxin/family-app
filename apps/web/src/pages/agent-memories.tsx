import { useState } from 'react';
import type { AgentMemoryItem, AgentMemoryScope, AgentMemoryStatus } from '@family/contracts';
import { useAgentMemories, useClearAgentMemories } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { AddMemoryForm, MemoryCard, MemoryDetail } from '../components/agent-memory-ui';
import { ListSkeleton } from '../components/skeleton';
import { SoftLink } from '../components/soft-link';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

const NO_ITEMS: AgentMemoryItem[] = [];

export function AgentMemoriesPage() {
  const { session } = useAuth();
  const [scope, setScope] = useState<AgentMemoryScope>('member_private');
  const [status, setStatus] = useState<AgentMemoryStatus>('active');
  const [open, setOpen] = useState<AgentMemoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);

  const memories = useAgentMemories(status, scope);
  const candidates = useAgentMemories('candidate', scope);
  const clear = useClearAgentMemories();

  const rows = memories.data ?? NO_ITEMS;
  // 生产环境没设 AGENT_DATA_KEY 时这些接口一律 503，值得直说，不然看着像坏了
  const notConfigured =
    memories.error instanceof Error && memories.error.message.includes('加密尚未配置');
  const pending = (candidates.data ?? NO_ITEMS).length;

  return (
    <Page
      title="小管家的记忆"
      subtitle="它记住了什么、哪些还没确认，都在这儿；随时可以改或忘掉"
      actions={
        <div className="flex gap-1.5">
          <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={() => setClearing(true)}>
            清空我的记忆
          </Button>
          <Button className="h-9 px-3 text-[13px]" onClick={() => setAdding(true)}>
            + 记一条
          </Button>
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'member_private' as const, label: '我的记忆' },
              { value: 'household' as const, label: '家庭共享' },
            ]}
          />
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active' as const, label: '已生效' },
              { value: 'candidate' as const, label: pending ? `待确认 ${pending}` : '待确认' },
            ]}
          />
        </div>
      }
    >
      <Panel className="p-3">
        {memories.isPending ? (
          <ListSkeleton rows={3} />
        ) : memories.isError ? (
          <EmptyState
            emoji="🧠"
            title={notConfigured ? '这台服务器还没配记忆加密' : '记忆读不出来'}
            hint={
              notConfigured
                ? '记忆内容是加密存的，生产环境要设置 AGENT_DATA_KEY 才能用，否则小管家不会记任何东西'
                : '刷新一下；一直不行就看看 API 日志'
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="🧠"
            title={status === 'candidate' ? '没有待确认的记忆' : '这里还什么都没记'}
            hint={
              scope === 'household'
                ? '家里人共享出来的偏好会出现在这儿'
                : '聊天时说过的偏好，小管家会先记成「待确认」，你点一下才生效'
            }
          />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2 lg:items-start">
            {rows.map((item) => (
              <MemoryCard key={item.id} item={item} onOpen={() => setOpen(item)} />
            ))}
          </div>
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col lg:w-[280px]">
        <Panel title="怎么用" grow={false}>
          <div className="flex flex-col gap-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-soft">
            <p>小管家只会用「已生效」的记忆；聊天里推测出来的先放「待确认」，你点确认才算数。</p>
            <p>共享到家庭之后全家都能看到，适合「家里不吃辣」这种大家都该知道的事。</p>
            <p>不想让它记了，在「我的」页把「启用记忆」关掉就行。</p>
            <SoftLink to="/me/assistant" className="text-accent transition-colors duration-150 hover:underline">
              回到对话 →
            </SoftLink>
          </div>
        </Panel>
      </aside>

      {open ? (
        <MemoryDetail
          key={open.id}
          item={open}
          meId={session?.member.id}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {adding ? <AddMemoryForm onClose={() => setAdding(false)} /> : null}

      {clearing ? (
        <Dialog
          title="清空我的记忆？"
          onClose={() => setClearing(false)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setClearing(false)}>
                再想想
              </Button>
              <Button
                className="flex-1 bg-danger hover:brightness-110"
                disabled={clear.isPending}
                onClick={() =>
                  clear.mutate(undefined, {
                    onSuccess: (result) => {
                      pushToast(`已忘掉 ${result.forgottenCount} 条`);
                      setClearing(false);
                    },
                  })
                }
              >
                全部忘掉
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">
            你自己的记忆会被抹掉（内容是加密存的，抹掉就找不回来了），只留一条「什么时候清空过」的审计记录。
            家里人共享的那些不受影响。
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
