import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { HouseholdReminder, ReminderStatus } from '@family/contracts';
import {
  ReminderForm,
  SOURCE_ICON,
  SOURCE_LABEL,
  formatSourceSchedule,
} from '../components/reminder-form';
import {
  useCancelReminder,
  useMembers,
  useReminderSources,
  useReminders,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { legacyUrl } from '../lib/nav';
import { pushToast } from '../lib/toast';
import { Button, Card, Dialog, Segmented } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

function shiftDays(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatRemindAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

const STATUS_LABEL: Record<ReminderStatus, string> = {
  scheduled: '待提醒',
  sent: '已发送',
  cancelled: '已取消',
};

function ReminderCard({
  reminder,
  onEdit,
  onCancel,
}: {
  reminder: HouseholdReminder;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const source = reminder.source;
  const manageable = reminder.status === 'scheduled' && reminder.canManage;

  // 已搬的域走新客户端，其余用契约给的 targetPath 回旧版——和日历那边同一套规矩
  const open = () => {
    if (!source) return;
    if (source.module === 'menu') navigate(`/eat/kitchen?date=${source.date ?? ''}`);
    else if (source.module === 'task') navigate('/schedule/tasks');
    else if (source.module === 'calendar') navigate('/schedule/calendar');
    else window.open(legacyUrl(source.targetPath), '_blank', 'noopener');
  };

  return (
    <Card className="p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[15px]">
          {SOURCE_ICON[reminder.sourceModule]}
        </span>
        <button
          type="button"
          disabled={!source}
          onClick={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="line-clamp-2 block text-sm font-medium">
            {source?.title ?? '原事项已不可用'}
          </span>
          <span className="mt-0.5 block text-[12px] text-ink-soft">
            {SOURCE_LABEL[reminder.sourceModule]} ·{' '}
            {source ? formatSourceSchedule(source) : '来源已删除'}
          </span>
        </button>
        <span
          className={
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
            (reminder.status === 'scheduled'
              ? 'bg-accent-soft text-accent'
              : reminder.status === 'sent'
                ? 'bg-warm-soft text-warm'
                : 'bg-muted text-ink-soft')
          }
        >
          {STATUS_LABEL[reminder.status]}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5">
        <span className="text-[13px]">
          <span className="text-ink-soft">提醒时间 </span>
          <span className="font-medium">{formatRemindAt(reminder.remindAt)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <span className="flex">
            {reminder.recipients.slice(0, 4).map((one, index) => (
              <span
                key={one.id}
                style={{ marginLeft: index ? -6 : 0 }}
                className="grid size-5 place-items-center rounded-full border border-surface bg-warm-soft text-[11px]"
              >
                {one.member.avatarEmoji}
              </span>
            ))}
          </span>
          {reminder.recipients.map((one) => one.member.name).join('、')}
        </span>

        {manageable ? (
          <span className="ml-auto flex gap-0.5">
            <button
              type="button"
              aria-label={`编辑提醒${source?.title ?? ''}`}
              onClick={onEdit}
              className="grid size-8 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-accent"
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`取消提醒${source?.title ?? ''}`}
              onClick={onCancel}
              className="grid size-8 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
            >
              🗑
            </button>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function RemindersPage() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<ReminderStatus | 'all'>('scheduled');
  const [editing, setEditing] = useState<HouseholdReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelling, setCancelling] = useState<HouseholdReminder | null>(null);

  const list = useReminders('all');
  const members = useMembers();
  const sources = useReminderSources(shiftDays(0), shiftDays(370));
  const cancel = useCancelReminder();

  // 日历那边的小铃铛带着来源参数跳过来，直接把表单开好、事项选好
  const deepKey = useMemo(() => {
    const module = params.get('sourceModule');
    const sourceId = params.get('sourceId');
    if (!module || !sourceId) return null;
    return `${module}:${sourceId}:${params.get('occurrenceDate') ?? ''}`;
  }, [params]);

  const [consumedKey, setConsumedKey] = useState<string | null>(null);
  if (deepKey && consumedKey !== deepKey) {
    setConsumedKey(deepKey);
    setEditing(null);
    setFormOpen(true);
  }

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    if (deepKey) setParams({}, { replace: true });
  };

  const rows = useMemo(() => {
    const all = list.data ?? [];
    const matched = filter === 'all' ? all : all.filter((one) => one.status === filter);
    // 待提醒按时间正序（最近的先到），其余按时间倒序（最近发生的在上面）
    return [...matched].sort((a, b) =>
      filter === 'scheduled'
        ? a.remindAt.localeCompare(b.remindAt)
        : b.remindAt.localeCompare(a.remindAt),
    );
  }, [list.data, filter]);

  const pending = (list.data ?? []).filter((one) => one.status === 'scheduled').length;

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 lg:mx-0 lg:px-8 pb-24 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">提醒中心</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {pending ? `还有 ${pending} 条待提醒` : '到点会推给指定的家人'}
          </p>
        </div>
        <Button
          className="h-9 px-3 text-[13px]"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + 新建提醒
        </Button>
      </header>

      <div className="mt-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'scheduled' as const, label: '待提醒' },
            { value: 'sent' as const, label: '已发送' },
            { value: 'cancelled' as const, label: '已取消' },
            { value: 'all' as const, label: '全部' },
          ]}
        />
      </div>

      {list.isPending ? (
        <ListSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">🔔</span>
          <p className="text-sm font-medium">
            {filter === 'scheduled' ? '没有待提醒的事' : '这一类没有记录'}
          </p>
          <p className="text-[13px] text-ink-soft">
            日历里每条安排右边的铃铛也能直接建提醒
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2 lg:items-start">
          {rows.map((reminder) => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              onEdit={() => {
                setEditing(reminder);
                setFormOpen(true);
              }}
              onCancel={() => setCancelling(reminder)}
            />
          ))}
        </div>
      )}

      {formOpen ? (
        <ReminderForm
          key={editing?.id ?? deepKey ?? 'new'}
          editing={editing}
          initialKey={editing ? null : deepKey}
          sources={sources.data ?? []}
          members={members.data ?? []}
          meId={session?.member.id}
          onClose={closeForm}
        />
      ) : null}

      {cancelling ? (
        <Dialog
          title="取消这条提醒"
          onClose={() => setCancelling(null)}
          maxWidth={380}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCancelling(null)}>
                先留着
              </Button>
              <Button
                className="flex-1"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(cancelling.id, {
                    onSuccess: () => {
                      pushToast('提醒已取消');
                      setCancelling(null);
                    },
                  })
                }
              >
                取消提醒
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">
            取消后不会再推送，记录仍留在「已取消」里，原事项不受影响。
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
