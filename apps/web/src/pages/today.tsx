import { useAuth } from '../lib/auth';
import {
  shiftDays,
  todayISO,
  useCalendarEntries,
  useMenusOfDate,
  useReminders,
  useShoppingList,
  useTaskRange,
  useAttention,
  useUpdateOccurrence,
} from '../lib/queries';
import { toNewRoute } from '../lib/routes';
import { Checkbox, EmptyState, Page, Panel } from '../components/ui';
import { Skeleton } from '../components/skeleton';
import { SoftLink } from '../components/soft-link';
import { TodayStats, type TodayStat } from '../components/today-hero';
import { TodayMeals } from '../components/today-meals';
import { TodayReminders, TodayShopping } from '../components/today-aside';
import { AttentionSection, nextHouseholdMidnight, useAttentionSnooze } from '../components/attention-card';
import { TaskAssignee } from '../components/task-assignee';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 「9月20日 星期六」——首页得先告诉人今天是几号，这是「今天」这两个字的前提。 */
function dateLine(date: Date) {
  const day = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
  const week = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
  return `${day} ${week}`;
}

function hhmm(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function TodayPage() {
  const { session } = useAuth();
  const today = todayISO();

  const range = useTaskRange(today, shiftDays(today, 2));
  const menus = useMenusOfDate(today);
  const reminders = useReminders('scheduled');
  const shopping = useShoppingList(today);
  const calendar = useCalendarEntries(today, today);
  const attention = useAttention();
  const update = useUpdateOccurrence();
  const memberId = session?.member.id ?? '';
  const { visible: visibleAttention, snooze } = useAttentionSnooze(attention.data?.items ?? [], memberId);
  const attentionToday = attention.data?.today ?? today;
  const timezone = session?.householdTimezone ?? 'Asia/Shanghai';

  const all = range.data ?? [];
  const todays = all.filter((item) => item.dueDate === today);
  const mine = todays.filter((item) => item.assigneeId === memberId);
  const family = todays.filter((item) => item.assigneeId !== memberId);
  const later = all.filter((item) => item.dueDate !== today && item.status === 'pending');
  const open = todays.filter((item) => item.status === 'pending');
  const unclaimed = open.filter((item) => !item.assigneeId);

  // 只看今天之内还没到点的提醒——「今天」这一页不该把下周的事也摆出来
  const todayReminders = (reminders.data ?? [])
    .filter((one) => one.remindAt.slice(0, 10) === today)
    .sort((a, b) => a.remindAt.localeCompare(b.remindAt));

  const toBuy = (shopping.data ?? []).filter((item) => !item.checked);
  // 日历里的 task / menu 就是上面那两块，首页再列一遍等于同一件事说三次
  const events = (calendar.data ?? [])
    .filter((one) => one.module !== 'task' && one.module !== 'menu')
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));

  const stats: TodayStat[] = [
    { key: 'task', label: '今天要做', value: open.length, unit: '件', to: '/schedule/tasks', tone: 'accent' },
    { key: 'buy', label: '要买的', value: toBuy.length, unit: '样', to: '/house/shopping', tone: 'warm' },
    { key: 'remind', label: '待提醒', value: todayReminders.length, unit: '条', to: '/schedule/reminders' },
  ];

  return (
    <Page
      title={`${greeting()}，${session?.member.name ?? ''}`}
      subtitle={
        range.isPending
          ? `${dateLine(new Date())} · 正在读今天的安排…`
          : `${dateLine(new Date())} · ${
              open.length === 0
                ? '今天没有待办了'
                : `还有 ${open.length} 件${unclaimed.length ? `，${unclaimed.length} 件没人认领` : ''}`
            }`
      }
      actions={
        <SoftLink
          to="/me/profile"
          aria-label="个人设置"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-xl transition-colors duration-150 hover:bg-accent-soft lg:hidden"
        >
          <span aria-hidden="true">{session?.member.avatarEmoji ?? '我'}</span>
        </SoftLink>
      }
      toolbar={<TodayStats stats={stats} />}
    >
      <div
        data-today-layout
        className={
          'flex min-h-0 w-full flex-1 flex-col gap-4 ' +
          (visibleAttention.length ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start' : '')
        }
      >
      <div data-today-main className="flex min-w-0 flex-col gap-4">
        <section>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-[13px] font-semibold tracking-wide text-ink-soft">今天吃什么</h2>
            <SoftLink to="/eat/kitchen" className="text-[13px] text-accent hover:underline">
              去厨房
            </SoftLink>
          </div>
          <TodayMeals menus={menus.data ?? []} date={today} pending={menus.isPending} />
        </section>

        <Panel
          title="今日待办"
          right={
            <SoftLink to="/schedule/tasks" className="shrink-0 text-[13px] text-accent hover:underline">
              全部任务
            </SoftLink>
          }
        >
          {range.isPending ? (
            <div className="px-3.5 py-3">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-3 h-4 w-3/5" />
              <Skeleton className="mt-3 h-4 w-1/3" />
            </div>
          ) : range.isError ? (
            <p className="px-3.5 py-6 text-sm text-danger">读不到任务，检查一下后端是否在跑</p>
          ) : todays.length === 0 ? (
            <EmptyState emoji="✅" title="今天没有安排任务" hint="轻松一天" />
          ) : (
            <>
              {([{ label: '我的', rows: mine }, { label: '全家', rows: family }] as const)
                .filter((group) => group.rows.length)
                .map((group) => (
                  <div key={group.label} data-task-group={group.label === '我的' ? 'mine' : 'family'}>
                    <p className="px-3.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-soft">{group.label}</p>
                    {group.rows.map((item) => (
                      <div
                        key={item.id}
                        data-task-row={item.taskId}
                        className="flex min-h-[48px] items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
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
                          className={
                            'min-w-0 flex-1 truncate text-[15px] ' +
                            (item.status === 'done' ? 'text-ink-soft line-through' : '')
                          }
                        >
                          {item.task.title}
                        </span>
                        {session ? <TaskAssignee item={item} member={session.member} /> : null}
                      </div>
                    ))}
                  </div>
                ))}
            </>
          )}

          {/* 接下来两天压在今天下面，灰一点——是提醒不是任务 */}
          {later.length ? (
            <div className="border-t border-border bg-muted/40">
              <p className="px-3.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-soft">接下来两天</p>
              {later.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 px-3.5 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
                    {item.task.title}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-soft">
                    {item.dueDate.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel
          title={`今天还有${events.length ? ` · ${events.length}` : ''}`}
          right={
            <SoftLink to="/schedule/calendar" className="shrink-0 text-[13px] text-accent hover:underline">
              日历
            </SoftLink>
          }
        >
          {calendar.isPending ? (
            <div className="px-3.5 py-3">
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : events.length === 0 ? (
            <p className="px-3.5 py-4 text-[13px] text-ink-soft">日历上没有别的安排了</p>
          ) : (
            events.map((entry) => {
              const target = toNewRoute(entry.targetPath);
              const body = (
                <>
                  <span className="w-11 shrink-0 text-[12px] font-medium tabular-nums text-ink-soft">
                    {entry.startsAt ? hhmm(entry.startsAt) : '全天'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{entry.title}</span>
                  {entry.summary ? (
                    <span className="hidden shrink-0 truncate text-[12px] text-ink-soft sm:block">
                      {entry.summary}
                    </span>
                  ) : null}
                </>
              );
              const cls =
                'flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0';
              return target ? (
                <SoftLink key={entry.id} to={target} className={`${cls} hover:bg-muted`}>
                  {body}
                </SoftLink>
              ) : (
                <div key={entry.id} className={cls}>
                  {body}
                </div>
              );
            })
          )}
        </Panel>

        <TodayReminders items={todayReminders} />
        <TodayShopping items={toBuy} />
      </div>
      {visibleAttention.length ? (
        <aside data-today-attention className="min-w-0">
          <AttentionSection
            items={visibleAttention}
            today={attentionToday}
            onSnooze={(key) => snooze(key, nextHouseholdMidnight(attentionToday, timezone))}
          />
        </aside>
      ) : null}
      </div>
    </Page>
  );
}
