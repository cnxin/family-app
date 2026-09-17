import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification, NotificationModule } from '@family/contracts';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../lib/queries';
import { legacyUrl } from '../lib/nav';
import { pushToast } from '../lib/toast';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

const MODULE_LABEL: Record<NotificationModule, string> = {
  menu: '菜单',
  task: '任务',
  poll: '投票',
  calendar: '日历',
  reminder: '提醒',
  media: '观影',
  guest: '访客',
  points: '积分',
  agent: '小管家',
  system: '系统',
};

const MODULE_ICON: Record<NotificationModule, string> = {
  menu: '🍲',
  task: '✅',
  poll: '🗳',
  calendar: '📅',
  reminder: '🔔',
  media: '🎬',
  guest: '👋',
  points: '🎁',
  agent: '🤖',
  system: '⚙️',
};

/** 已搬的域在新客户端里的落点；其余回旧版，用后端给的 targetPath。 */
const NEW_ROUTE: Partial<Record<NotificationModule, string>> = {
  menu: '/eat/kitchen',
  task: '/schedule/tasks',
  calendar: '/schedule/calendar',
  reminder: '/schedule/reminders',
};

function when(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function NotificationRow({
  item,
  onRead,
}: {
  item: AppNotification;
  onRead: () => void;
}) {
  const navigate = useNavigate();
  const unread = !item.readAt;

  // 点开就顺手标已读——看过了还留着未读，下次还得再扫一遍
  const open = () => {
    if (unread) onRead();
    const route = NEW_ROUTE[item.module];
    if (route) navigate(route);
    else window.open(legacyUrl(item.targetPath), '_blank', 'noopener');
  };

  return (
    <div
      className={
        'flex items-start gap-2.5 border-b border-border px-3.5 py-3 last:border-b-0 ' +
        (unread ? 'bg-accent-soft/40' : '')
      }
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[15px]">
        {MODULE_ICON[item.module]}
      </span>

      <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
        <span className="flex items-start gap-2">
          <span
            className={
              'min-w-0 flex-1 text-sm ' + (unread ? 'font-semibold' : 'font-medium text-ink-soft')
            }
          >
            {item.title}
          </span>
          {unread ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        </span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-soft">{item.body}</span>
        ) : null}
        <span className="mt-1 block text-[11px] text-ink-soft/80">
          {MODULE_LABEL[item.module]} · {when(item.createdAt)}
        </span>
      </button>

      {unread ? (
        <button
          type="button"
          aria-label={`标记「${item.title}」为已读`}
          onClick={onRead}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-accent"
        >
          ✓
        </button>
      ) : null}
    </div>
  );
}

export function NotificationsPage() {
  const [scope, setScope] = useState<'unread' | 'all'>('unread');
  const [module, setModule] = useState<NotificationModule | 'all'>('all');

  const list = useNotifications(scope === 'all');
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const rows = useMemo(() => {
    const all = list.data ?? [];
    return module === 'all' ? all : all.filter((one) => one.module === module);
  }, [list.data, module]);

  const unread = (list.data ?? []).filter((one) => !one.readAt).length;

  // 筛选条只列真的有消息的那几类——十个分类全摆出来，大半是空的
  const presentModules = useMemo(() => {
    const seen = new Set<NotificationModule>();
    for (const one of list.data ?? []) seen.add(one.module);
    return [...seen];
  }, [list.data]);

  return (
    <Page
      title="消息"
      subtitle={unread ? `${unread} 条未读` : '都看过了'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {unread ? (
            <Button
              variant="outline"
              className="h-9 px-3 text-[13px]"
              disabled={markAll.isPending}
              onClick={() =>
                markAll.mutate(undefined, {
                  onSuccess: (result) => pushToast(`已把 ${result.updated} 条标为已读`),
                })
              }
            >
              {markAll.isPending ? '处理中…' : '全部已读'}
            </Button>
          ) : null}
          <a
            href={legacyUrl('/notifications')}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted"
          >
            外部渠道设置 ↗
          </a>
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'unread' as const, label: '未读' },
              { value: 'all' as const, label: '全部' },
            ]}
          />
          {presentModules.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {(['all', ...presentModules] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={value === module}
                  onClick={() => setModule(value)}
                  className={
                    'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ' +
                    (value === module
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border bg-surface text-ink-soft hover:bg-muted')
                  }
                >
                  {value === 'all' ? '全部' : MODULE_LABEL[value]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      }
    >
      <Panel title={`${rows.length} 条`}>
        {list.isPending ? (
          <div className="p-3">
            <ListSkeleton rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="📭"
            title={scope === 'unread' ? '没有未读消息' : '还没有消息'}
            hint="菜单、任务、提醒有动静时会推到这儿"
          />
        ) : (
          rows.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onRead={() => markRead.mutate(item.id)}
            />
          ))
        )}
      </Panel>
    </Page>
  );
}
