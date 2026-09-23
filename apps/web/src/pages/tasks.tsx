import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import {
  shiftDays,
  todayISO,
  useCreateTask,
  useTaskRange,
  useUpdateOccurrence,
} from '../lib/queries';
import { TaskAssignee } from '../components/task-assignee';
import { Button, Card, Checkbox, EmptyState, Input, Page, Panel, SectionTitle } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

export function TasksPage() {
  const { session } = useAuth();
  const today = todayISO();
  const range = useTaskRange(today, shiftDays(today, 13));
  const update = useUpdateOccurrence();
  const create = useCreateTask();
  const [title, setTitle] = useState('');

  const byDate = new Map<string, typeof range.data>();
  for (const item of range.data ?? []) {
    const bucket = byDate.get(item.dueDate) ?? [];
    bucket.push(item);
    byDate.set(item.dueDate, bucket);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await create.mutateAsync({ title: trimmed, startsOn: today, recurrence: 'once' });
    setTitle('');
  }

  return (
    <Page
      title="家庭任务"
      subtitle="未来两周的安排"
      toolbar={
        <>
          <form onSubmit={add} className="flex gap-2">
            <Input
              value={title}
              placeholder="加一件今天要做的事"
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button type="submit" disabled={!title.trim() || create.isPending} className="shrink-0">
              {create.isPending ? '添加中…' : '添加'}
            </Button>
          </form>
          {create.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              没加上：{(create.error as Error).message}
            </p>
          ) : null}
        </>
      }
    >
      <Panel title={`${range.data?.length ?? 0} 项`}>
      {range.isPending ? (
        <div className="p-3">
          <ListSkeleton rows={5} />
        </div>
      ) : byDate.size === 0 ? (
        <EmptyState emoji="📋" title="这两周还没有任务" hint="在上面的输入框加一件" />
      ) : (
        // 宽屏一列会把右边空出来，日期分组排两列
        <div className="grid gap-x-5 p-3 lg:grid-cols-2 lg:items-start">
        {[...byDate.entries()].map(([date, items]) => (
          <section key={date} className="mb-4 last:mb-0">
            <SectionTitle>
              {date === today ? '今天' : date === shiftDays(today, 1) ? '明天' : date}
            </SectionTitle>
            <Card>
              {(items ?? []).map((item, index) => (
                <div
                  key={item.id}
                  className={`flex min-h-[52px] items-center gap-3 px-4 py-3 ${
                    index ? 'border-t border-border' : ''
                  }`}
                >
                  <Checkbox
                    label={`完成${item.task.title}`}
                    checked={item.status === 'done'}
                    disabled={!item.canUpdate || update.isPending}
                    onChange={() =>
                      update.mutate({
                        taskId: item.taskId,
                        dueDate: item.dueDate,
                        body: { status: item.status === 'done' ? 'pending' : 'done' },
                      })
                    }
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[15px] ${
                      item.status === 'done' ? 'text-ink-soft line-through' : ''
                    }`}
                  >
                    {item.task.title}
                  </span>
                  {session ? <TaskAssignee item={item} member={session.member} /> : null}
                </div>
              ))}
            </Card>
          </section>
        ))}
        </div>
      )}
      </Panel>
    </Page>
  );
}
