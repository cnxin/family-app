import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TaskOccurrence } from '@family/contracts';
import { useCreateIntent } from '../lib/create-intent';
import { useTaskIntent } from '../lib/task-intent';
import { useAuth } from '../lib/auth';
import { useHouseholdToday } from '../lib/use-household-today';
import {
  shiftDays,
  useCreateTask,
  useTaskRange,
  useUpdateOccurrence,
} from '../lib/queries';
import { TaskAssignee } from '../components/task-assignee';
import { TaskDetail } from '../components/task-detail';
import { QueryFrame } from '../components/query-state';
import { Button, Card, Checkbox, EmptyState, Input, Page, Panel, SectionTitle } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

export function TasksPage() {
  const { session } = useAuth();
  const today = useHouseholdToday();
  // 显示范围：今天起两周；深链的 date 只在这个范围里才当首选
  const lastDay = shiftDays(today, 13);
  const range = useTaskRange(today, lastDay);
  const update = useUpdateOccurrence();
  const create = useCreateTask();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState<TaskOccurrence | null>(null);
  const armFocus = useRef(false);
  useCreateIntent(() => {
    armFocus.current = true;
  });
  useEffect(() => {
    if (!armFocus.current) return;
    armFocus.current = false;
    const node = document.getElementById('task-create');
    node?.scrollIntoView({ block: 'center' });
    node?.focus();
  }, []);

  // ?task=<id>（留意卡）或 ?taskId=<id>&date=<d>（通知、日历、提醒、动态）：滚到那一次并高亮 2 秒。
  // 等后台重取结束再挑：缓存里还没有刚指派的那件时，别拿旧列表判成「没找到」把参数抹了
  const highlighted = useTaskIntent(
    range.data,
    (range.data !== undefined && !range.isFetching) || range.isError,
    today,
    lastDay,
  );

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
              id="task-create"
              value={title}
              placeholder="加一件今天要做的事"
              aria-label="任务内容"
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
        <QueryFrame query={range} skeleton={<div className="p-3"><ListSkeleton rows={5} /></div>}>
        {byDate.size === 0 ? (
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
                  data-task-occurrence={item.id}
                  data-highlighted={highlighted === item.id || undefined}
                  className={`flex min-h-[52px] items-center gap-3 px-4 py-3 transition-colors duration-300 ease-out ${
                    index ? 'border-t border-border' : ''
                  } ${highlighted === item.id ? 'bg-accent-soft' : ''}`}
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
                  <button
                    type="button"
                    aria-label={`看看${item.task.title}`}
                    onClick={() => setDetail(item)}
                    className={
                      'min-h-11 min-w-0 flex-1 truncate rounded-md text-left text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                      (item.status === 'done' ? 'text-ink-soft line-through' : '')
                    }
                  >
                    {item.task.title}
                  </button>
                  {session ? <TaskAssignee item={item} member={session.member} /> : null}
                </div>
              ))}
            </Card>
          </section>
        ))}
        </div>
      )}
        </QueryFrame>
      </Panel>
      {detail ? <TaskDetail item={detail} onClose={() => setDetail(null)} /> : null}
    </Page>
  );
}
