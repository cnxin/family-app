import { Link } from 'react-router-dom';
import type { Menu, MenuItem } from '@family/contracts';
import { useAuth } from '../lib/auth';
import {
  MEAL_LABELS,
  shiftDays,
  todayISO,
  useMenusOfDate,
  useReminders,
  useShoppingList,
  useTaskRange,
  useUpdateOccurrence,
} from '../lib/queries';
import { Checkbox, EmptyState, Page, Panel } from '../components/ui';
import { Skeleton } from '../components/skeleton';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function clock(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/** 这一餐的一句话：几道菜、谁在做、到哪步了。 */
function mealLine(menu: Menu) {
  const live = menu.items.filter((item: MenuItem) => item.status !== 'rejected');
  if (!live.length) return '还没点';
  const done = live.filter((item: MenuItem) => item.status === 'done').length;
  const names = live
    .slice(0, 3)
    .map((item: MenuItem) => item.dish?.name ?? '')
    .filter(Boolean)
    .join('、');
  const more = live.length > 3 ? ` 等 ${live.length} 道` : '';
  return `${names}${more}${done ? ` · 已上桌 ${done}/${live.length}` : ''}`;
}

export function TodayPage() {
  const { session } = useAuth();
  const today = todayISO();

  const range = useTaskRange(today, shiftDays(today, 2));
  const menus = useMenusOfDate(today);
  const reminders = useReminders('scheduled');
  const shopping = useShoppingList(today);
  const update = useUpdateOccurrence();

  const all = range.data ?? [];
  const todays = all.filter((item) => item.dueDate === today);
  const later = all.filter((item) => item.dueDate !== today && item.status === 'pending');
  const open = todays.filter((item) => item.status === 'pending');
  const unclaimed = open.filter((item) => !item.assigneeId);

  const meals = menus.data ?? [];
  const anyDish = meals.some((menu) => menu.items.some((item) => item.status !== 'rejected'));

  // 只看今天之内还没到点的提醒——「今天」这一页不该把下周的事也摆出来
  const todayReminders = (reminders.data ?? [])
    .filter((one) => one.remindAt.slice(0, 10) === today)
    .sort((a, b) => a.remindAt.localeCompare(b.remindAt));

  const toBuy = (shopping.data ?? []).filter((item) => !item.checked);

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
      {/* 左栏是「今天要做什么」，右栏是「顺带要知道的」 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Panel
          grow={false}
          title="今天吃什么"
          right={
            <Link to="/eat/kitchen" className="shrink-0 text-[13px] text-accent hover:underline">
              去厨房
            </Link>
          }
        >
          {menus.isPending ? (
            <div className="px-3.5 py-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-3 h-4 w-1/2" />
            </div>
          ) : !anyDish ? (
            <EmptyState
              emoji="🍚"
              title="今天还没点菜"
              hint={
                <Link to="/eat/order" className="text-accent hover:underline">
                  去点菜 →
                </Link>
              }
            />
          ) : (
            meals.map((menu) => {
              const live = menu.items.filter((item) => item.status !== 'rejected');
              return (
                <Link
                  key={menu.id}
                  to={`/eat/kitchen?date=${today}`}
                  className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-muted"
                >
                  <span className="w-10 shrink-0 text-[13px] font-medium text-ink-soft">
                    {MEAL_LABELS[menu.mealType]}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 truncate text-sm ' + (live.length ? '' : 'text-ink-soft')
                    }
                  >
                    {mealLine(menu)}
                  </span>
                  {menu.chef ? (
                    <span className="shrink-0 text-[12px] text-ink-soft">
                      {menu.chef.avatarEmoji} {menu.chef.name}
                    </span>
                  ) : null}
                </Link>
              );
            })
          )}
        </Panel>

        <Panel
          title="今日待办"
          right={
            <Link to="/schedule/tasks" className="shrink-0 text-[13px] text-accent hover:underline">
              全部任务
            </Link>
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
            <EmptyState emoji="✅" title="今天没有安排任务" />
          ) : (
            todays.map((item) => (
              <div
                key={item.id}
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
                <span className="shrink-0 text-xs text-ink-soft">
                  {item.assignee?.name ?? '待认领'}
                </span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <aside className="flex min-h-0 flex-col gap-4 lg:w-[320px] lg:flex-none">
        <Panel
          grow={false}
          title={`待提醒${todayReminders.length ? ` · ${todayReminders.length}` : ''}`}
          right={
            <Link
              to="/schedule/reminders"
              className="shrink-0 text-[13px] text-accent hover:underline"
            >
              全部
            </Link>
          }
        >
          {todayReminders.length ? (
            todayReminders.slice(0, 5).map((one) => (
              <div
                key={one.id}
                className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <span className="shrink-0 text-[13px] font-medium tabular-nums">
                  {clock(one.remindAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {one.source?.title ?? '原事项已不可用'}
                </span>
              </div>
            ))
          ) : (
            <p className="px-3.5 py-4 text-[13px] text-ink-soft">今天没有要提醒的事</p>
          )}
        </Panel>

        <Panel
          grow={false}
          title={`要买的${toBuy.length ? ` · ${toBuy.length}` : ''}`}
          right={
            <Link to="/eat/shopping" className="shrink-0 text-[13px] text-accent hover:underline">
              购物清单
            </Link>
          }
        >
          {toBuy.length ? (
            toBuy.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {item.ingredient?.name ?? item.customName ?? '未知'}
                </span>
                {item.totalQty ? (
                  <span className="shrink-0 text-[12px] text-ink-soft">
                    {Number(item.totalQty)} {item.unit ?? ''}
                  </span>
                ) : null}
              </div>
            ))
          ) : (
            <p className="px-3.5 py-4 text-[13px] text-ink-soft">今天没有要买的</p>
          )}
        </Panel>

        <Panel title="接下来两天">
          {later.length ? (
            later.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{item.task.title}</span>
                <span className="shrink-0 font-mono text-[12px] text-ink-soft">
                  {item.dueDate.slice(5)}
                </span>
              </div>
            ))
          ) : (
            <p className="px-3.5 py-4 text-[13px] text-ink-soft">这两天没有别的安排</p>
          )}
        </Panel>
      </aside>
    </Page>
  );
}
