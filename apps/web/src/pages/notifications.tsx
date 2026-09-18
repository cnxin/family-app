import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification, NotificationChannel, NotificationModule } from '@family/contracts';
import {
  useDeleteNotificationChannel,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationChannels,
  useNotificationDeliveries,
  useNotifications,
} from '../lib/queries';
import { legacyUrl } from '../lib/nav';
import { toNewRoute } from '../lib/routes';
import { MODULE_ICON, MODULE_LABEL } from '../lib/notification-meta';
import { pushToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { ChannelCard, ChannelEditor, DeliveryList } from '../components/channel-settings';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

type View = 'inbox' | 'channels' | 'deliveries';

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

function NotificationRow({ item, onRead }: { item: AppNotification; onRead: () => void }) {
  const navigate = useNavigate();
  const unread = !item.readAt;

  // 点开就顺手标已读——看过了还留着未读，下次还得再扫一遍
  const open = () => {
    if (unread) onRead();
    const route = toNewRoute(item.targetPath);
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
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const [view, setView] = useState<View>('inbox');
  const [scope, setScope] = useState<'unread' | 'all'>('unread');
  const [module, setModule] = useState<NotificationModule | 'all'>('all');
  const [channelForm, setChannelForm] = useState<NotificationChannel | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null);

  const list = useNotifications(scope === 'all');
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const channels = useNotificationChannels();
  const deliveries = useNotificationDeliveries(view === 'deliveries');
  const deleteChannel = useDeleteNotificationChannel();

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

  const channelRows = channels.data ?? [];

  return (
    <Page
      title="消息"
      subtitle={
        view === 'channels'
          ? '外部渠道和我的接收范围'
          : view === 'deliveries'
            ? '外部投递状态与重试'
            : unread
              ? `${unread} 条未读`
              : '都看过了'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {view === 'inbox' && unread ? (
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
          {view === 'channels' && manager ? (
            <Button className="h-9 px-3 text-[13px]" onClick={() => setChannelForm('new')}>
              + 新增渠道
            </Button>
          ) : null}
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'inbox' as const, label: unread ? `消息 ${unread}` : '消息' },
              { value: 'channels' as const, label: '外部渠道' },
              { value: 'deliveries' as const, label: '投递记录' },
            ]}
          />
          {view === 'inbox' ? (
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: 'unread' as const, label: '未读' },
                { value: 'all' as const, label: '全部' },
              ]}
            />
          ) : null}
          {view === 'inbox' && presentModules.length > 1 ? (
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
      {view === 'inbox' ? (
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
              <NotificationRow key={item.id} item={item} onRead={() => markRead.mutate(item.id)} />
            ))
          )}
        </Panel>
      ) : view === 'channels' ? (
        <Panel className="p-3">
          {channels.isPending ? (
            <ListSkeleton rows={2} />
          ) : channelRows.length === 0 ? (
            <EmptyState
              emoji="📡"
              title="还没有外部渠道"
              hint={
                manager
                  ? '加一个 ntfy 或 Webhook，家里人就能各自选要收哪些通知'
                  : '等家庭管理员先配好渠道'
              }
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
              {channelRows.map((one) => (
                <ChannelCard
                  key={one.id}
                  channel={one}
                  manager={manager}
                  onEdit={() => setChannelForm(one)}
                  onDelete={() => setDeleting(one)}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : (
        <Panel className="p-3">
          {deliveries.isPending ? (
            <ListSkeleton rows={4} />
          ) : (
            <DeliveryList deliveries={deliveries.data ?? []} />
          )}
        </Panel>
      )}

      {channelForm ? (
        <ChannelEditor
          key={channelForm === 'new' ? 'new' : channelForm.id}
          editing={channelForm === 'new' ? null : channelForm}
          onClose={() => setChannelForm(null)}
        />
      ) : null}

      {deleting ? (
        <Dialog
          title={`删除渠道「${deleting.name}」？`}
          onClose={() => setDeleting(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
                再想想
              </Button>
              <Button
                className="flex-1 bg-danger hover:brightness-110"
                disabled={deleteChannel.isPending}
                onClick={() =>
                  deleteChannel.mutate(deleting.id, {
                    onSuccess: () => {
                      pushToast(`渠道「${deleting.name}」已删除`);
                      setDeleting(null);
                    },
                  })
                }
              >
                删除渠道
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">
            删除后家里人都不会再收到这个渠道的推送，已有的投递记录保留。站内消息不受影响。
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
