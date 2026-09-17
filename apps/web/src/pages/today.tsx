import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { shiftDays, todayISO, useTaskRange, useUpdateOccurrence } from '../lib/queries';
import { Checkbox, Page, Panel } from '../components/ui';
import { Skeleton } from '../components/skeleton';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function TodayPage() {
  const { session } = useAuth();
  const today = todayISO();
  const range = useTaskRange(today, shiftDays(today, 2));
  const update = useUpdateOccurrence();

  const all = range.data ?? [];
  const todays = all.filter((item) => item.dueDate === today);
  const later = all.filter((item) => item.dueDate !== today && item.status === 'pending');
  const open = todays.filter((item) => item.status === 'pending');
  const unclaimed = open.filter((item) => !item.assigneeId);

  return (
    <Page
      title={`${greeting()}，${session?.member.name ?? ''}`}
      subtitle={
        range.isPending
          ? '正在读取今天的安排…'
          : open.length === 0
            ? '今天没有待办了'
            : `今天还有 ${open.length} 件${unclaimed.length ? ` · ${unclaimed.length} 件没人认领` : ''}`
      }
    >
      <Panel
        title="今日待办"
        right={
          <Link to="/schedule/tasks" className="shrink-0 text-[13px] text-accent hover:underline">
            全部任务
          </Link>
        }
      >
        <div>
          {range.isPending ? (
            <div className="px-4 py-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-3 h-4 w-3/5" />
              <Skeleton className="mt-3 h-4 w-1/3" />
            </div>
          ) : range.isError ? (
            <p className="px-4 py-6 text-sm text-danger">读不到任务，检查一下后端是否在跑</p>
          ) : todays.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">今天没有安排任务</p>
          ) : (
            todays.map((item, index) => (
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
            ))
          )}
        </div>
      </Panel>

      {later.length > 0 ? (
        <Panel title="接下来两天">
          <div>
            {later.map((item, index) => (
              <div
                key={item.id}
                className={`flex min-h-[46px] items-center gap-3 px-4 py-2.5 ${
                  index ? 'border-t border-border' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{item.task.title}</span>
                <span className="shrink-0 font-mono text-xs text-ink-soft">{item.dueDate.slice(5)}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}
