import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  shiftDays,
  todayISO,
  useCreateTask,
  useTaskRange,
  useUpdateOccurrence,
} from '../lib/queries';
import { Button, Card, Checkbox, Input, SectionTitle } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

export function TasksPage() {
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
    <div className="mx-auto w-full max-w-[760px] px-4 lg:mx-0 lg:px-8 pb-16 pt-6">
      <h1 className="px-1 text-2xl font-semibold tracking-tight">家庭任务</h1>
      <p className="mt-1 px-1 text-sm text-ink-soft">未来两周的安排</p>

      <form onSubmit={add} className="mt-5 flex gap-2">
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
        <p role="alert" className="mt-2 px-1 text-[13px] text-danger">
          没加上：{(create.error as Error).message}
        </p>
      ) : null}

      {range.isPending ? (
        <ListSkeleton rows={5} />
      ) : byDate.size === 0 ? (
        <p className="mt-8 px-1 text-sm text-ink-soft">这两周还没有任务</p>
      ) : (
        [...byDate.entries()].map(([date, items]) => (
          <section key={date} className="mt-6">
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
                  <span className="shrink-0 text-xs text-ink-soft">
                    {item.assignee?.name ?? '待认领'}
                  </span>
                </div>
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
