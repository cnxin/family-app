import { useEffect, useMemo, useState } from 'react';
import type {
  HouseholdReminder,
  MemberProfile,
  ReminderSource,
  ReminderSourceModule,
} from '@family/contracts';
import { useUpsertReminder } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

export const SOURCE_LABEL: Record<ReminderSourceModule, string> = {
  menu: '菜单',
  task: '任务',
  calendar: '日程',
  poll: '投票',
  maintenance: '维护',
  travel: '出行',
};

export const SOURCE_ICON: Record<ReminderSourceModule, string> = {
  menu: '🍲',
  task: '✅',
  calendar: '📅',
  poll: '🗳',
  maintenance: '🔧',
  travel: '✈️',
};

export function sourceKey(
  source: Pick<ReminderSource, 'module' | 'sourceId' | 'occurrenceDate'>,
) {
  return `${source.module}:${source.sourceId}:${source.occurrenceDate ?? ''}`;
}

function dateStr(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parts(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return {
    date: dateStr(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

export function formatSourceSchedule(source: ReminderSource) {
  if (source.startsAt) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(source.startsAt));
  }
  if (source.date) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    }).format(new Date(`${source.date}T12:00:00`));
  }
  return '未设置截止时间';
}

/**
 * 默认提醒时间照搬旧客户端：这段是几十轮使用攒出来的经验，不是随便定的。
 * 有开始时间就提前一小时；菜单按餐次（早 7 / 午 11 / 晚 17，因为要买菜和备料）；
 * 任务早上 8 点；其余 9 点。算出来的时间已经过去了，就取一小时后并向上取整到一刻钟。
 */
function defaultRemindAt(source: ReminderSource | null) {
  let date = source?.date
    ? new Date(`${source.date}T12:00:00`)
    : new Date(Date.now() + 86_400_000);

  if (source?.startsAt) {
    date = new Date(new Date(source.startsAt).getTime() - 3_600_000);
  } else if (source?.module === 'menu') {
    const hour = source.title.includes('早餐') ? 7 : source.title.includes('午餐') ? 11 : 17;
    date.setHours(hour, 0, 0, 0);
  } else if (source?.module === 'task') {
    date.setHours(8, 0, 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }

  if (date.getTime() <= Date.now()) {
    date = new Date(Date.now() + 3_600_000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  }
  return parts(date);
}

export function ReminderForm({
  editing,
  initialKey,
  sources,
  members,
  meId,
  onClose,
}: {
  editing: HouseholdReminder | null;
  initialKey: string | null;
  sources: ReminderSource[];
  members: MemberProfile[];
  meId: string | undefined;
  onClose: () => void;
}) {
  const save = useUpsertReminder();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReminderSourceModule | 'all'>('all');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('09:00');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = editing?.source
      ? sourceKey(editing.source)
      : editing
        ? `${editing.sourceModule}:${editing.sourceId}:${editing.occurrenceDate ?? ''}`
        : (initialKey ?? (sources[0] ? sourceKey(sources[0]) : null));
    const selected =
      sources.find((one) => sourceKey(one) === key) ?? editing?.source ?? null;
    const initial = editing ? parts(editing.remindAt) : defaultRemindAt(selected);
    setSelectedKey(key);
    setFilter(selected?.module ?? 'all');
    setDay(initial.date);
    setTime(initial.time);
    setRecipients(
      editing?.recipients.map((one) => one.member.id) ?? (meId ? [meId] : []),
    );
  }, [editing, initialKey, sources, meId]);

  const selected =
    sources.find((one) => sourceKey(one) === selectedKey) ?? editing?.source ?? null;

  // 一年的事项可能几百条，列表里只摆前 30 条；已选中的那条永远置顶，免得翻不到
  const visible = useMemo(() => {
    const matched = sources.filter((one) => filter === 'all' || one.module === filter);
    const rest = matched.filter((one) => sourceKey(one) !== selectedKey).slice(0, 29);
    return selected && (filter === 'all' || selected.module === filter)
      ? [selected, ...rest]
      : matched.slice(0, 30);
  }, [sources, filter, selectedKey, selected]);

  const remindAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? new Date(`${day}T${time}:00`) : null;
  const valid = Boolean(selected) && Boolean(remindAt) && recipients.length > 0;

  const submit = () => {
    if (!selected || !remindAt) {
      setError('请选择要提醒的事项和时间');
      return;
    }
    if (!recipients.length) {
      setError('至少选一个接收人');
      return;
    }
    setError(null);
    save.mutate(
      {
        id: editing?.id,
        sourceModule: selected.module,
        sourceId: selected.sourceId,
        occurrenceDate: selected.occurrenceDate,
        remindAt: remindAt.toISOString(),
        recipientIds: recipients,
      },
      {
        onSuccess: () => {
          pushToast(editing ? '提醒已更新' : `会在设定时间提醒「${selected.title}」`);
          onClose();
        },
        onError: (mutationError) =>
          setError(mutationError instanceof Error ? mutationError.message : '保存失败'),
      },
    );
  };

  return (
    <Dialog
      title={editing ? '修改提醒' : '新建提醒'}
      onClose={onClose}
      maxWidth={520}
      footer={
        <Button className="w-full" disabled={!valid || save.isPending} onClick={submit}>
          {save.isPending ? '保存中…' : '保存'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {editing ? (
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[12px] text-ink-soft">提醒的事项</p>
            <p className="mt-0.5 text-sm font-medium">
              {SOURCE_ICON[editing.sourceModule]} {editing.source?.title ?? '原事项已不可用'}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-soft">建好之后就不能换事项了</p>
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-[12px] text-ink-soft">提醒哪件事</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(['all', ...(Object.keys(SOURCE_LABEL) as ReminderSourceModule[])] as const).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={value === filter}
                    onClick={() => setFilter(value)}
                    className={
                      'rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150 ' +
                      (value === filter
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface text-ink-soft hover:bg-muted')
                    }
                  >
                    {value === 'all' ? '全部' : SOURCE_LABEL[value]}
                  </button>
                ),
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {visible.length ? (
                visible.map((source) => {
                  const key = sourceKey(source);
                  const active = key === selectedKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedKey(key);
                        const next = defaultRemindAt(source);
                        setDay(next.date);
                        setTime(next.time);
                      }}
                      className={
                        'flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left ' +
                        'transition-colors duration-150 last:border-b-0 ' +
                        (active ? 'bg-accent-soft' : 'hover:bg-muted')
                      }
                    >
                      <span className="text-[15px]">{SOURCE_ICON[source.module]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{source.title}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-soft">
                          {SOURCE_LABEL[source.module]} · {formatSourceSchedule(source)}
                        </span>
                      </span>
                      {active ? <span className="text-accent">✓</span> : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-6 text-center text-[13px] text-ink-soft">
                  这一类暂时没有可提醒的事项
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">提醒日期</span>
            <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">提醒时间</span>
            <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] text-ink-soft">提醒谁</p>
          <div className="flex flex-wrap gap-1.5">
            {members.map((member) => {
              const on = recipients.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setRecipients((current) =>
                      current.includes(member.id)
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id],
                    )
                  }
                  className={
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] ' +
                    'transition-colors duration-150 ' +
                    (on
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border bg-surface text-ink-soft hover:bg-muted')
                  }
                >
                  <span>{member.avatarEmoji}</span>
                  {member.name}
                </button>
              );
            })}
          </div>
        </div>

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}
