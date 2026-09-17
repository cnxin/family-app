import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CalendarEntry } from '@family/contracts';
import {
  calendarRange,
  CalendarMonth,
  parseDate,
  startOfMonth,
  toDateStr,
} from '../components/calendar-month';
import { EventForm } from '../components/event-form';
import { useCalendarEntries, useDeleteCalendarEvent } from '../lib/queries';
import { legacyUrl } from '../lib/nav';
import { pushToast } from '../lib/toast';
import { Button, Dialog, EmptyState, Page, Panel } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

/** 七类来源各给一个字形和一种色，扫一眼就知道这条是哪来的。 */
const MODULE_META: Record<CalendarEntry['module'], { icon: string; tone: string }> = {
  menu: { icon: '🍲', tone: 'bg-warm-soft text-warm' },
  calendar: { icon: '📅', tone: 'bg-accent-soft text-accent' },
  task: { icon: '✅', tone: 'bg-muted text-ink-soft' },
  media: { icon: '🎬', tone: 'bg-muted text-ink-soft' },
  guest: { icon: '👋', tone: 'bg-muted text-ink-soft' },
  maintenance: { icon: '🔧', tone: 'bg-muted text-ink-soft' },
  travel: { icon: '✈️', tone: 'bg-muted text-ink-soft' },
};

const MODULE_LABEL: Record<CalendarEntry['module'], string> = {
  menu: '吃饭',
  calendar: '家庭事件',
  task: '任务',
  media: '观影',
  guest: '来访',
  maintenance: '维护',
  travel: '出行',
};

function fullDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(parseDate(value));
}

function eventTime(entry: CalendarEntry) {
  if (!entry.startsAt) return '全天';
  const format = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const start = format.format(new Date(entry.startsAt));
  return entry.endsAt ? `${start} - ${format.format(new Date(entry.endsAt))}` : start;
}

/** 右侧那行小字：每类来源最该先看到的一句，照旧客户端的分法。 */
function metaOf(entry: CalendarEntry) {
  const meta = entry.metadata;
  switch (entry.module) {
    case 'menu':
      return entry.summary ?? '';
    case 'task':
      return entry.status === 'done'
        ? '已完成'
        : entry.status === 'skipped'
          ? '已跳过'
          : (meta.assigneeName ?? '待认领');
    case 'media':
      return entry.status === 'completed'
        ? '已看完'
        : entry.status === 'watching'
          ? '观看中'
          : '观影安排';
    case 'guest':
      return `${meta.guestCount ?? 0} 位访客`;
    case 'maintenance':
      return `每 ${meta.frequencyDays ?? '-'} 天`;
    case 'travel':
      return `${meta.completedItems ?? 0}/${meta.totalItems ?? 0} 项`;
    default:
      return eventTime(entry);
  }
}

/**
 * 点一条要去哪儿：已经搬到新客户端的直接跳，没搬的用契约里给的 targetPath 回旧版。
 * targetPath 是后端给的旧客户端路径，正好当回退用，不用在这儿维护一张映射表。
 */
function useOpenEntry() {
  const navigate = useNavigate();
  return (entry: CalendarEntry) => {
    if (entry.module === 'menu') {
      navigate(`/eat/kitchen?date=${entry.date}`);
      return;
    }
    if (entry.module === 'task') {
      navigate('/schedule/tasks');
      return;
    }
    if (entry.module === 'calendar') return;
    window.open(legacyUrl(entry.targetPath), '_blank', 'noopener');
  };
}

function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: CalendarEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const open = useOpenEntry();
  const meta = MODULE_META[entry.module];
  const own = entry.module === 'calendar';
  const canManage = own && Boolean(entry.metadata.canManage);
  // 未来的安排才谈得上提醒；提醒页还在旧版，带着来源参数跳过去
  const canRemind = entry.date >= toDateStr(new Date()) && entry.status !== 'done';

  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
      <button
        type="button"
        disabled={own}
        onClick={() => open(entry)}
        className={
          'flex min-w-0 flex-1 items-start gap-2.5 rounded-lg text-left transition-colors duration-150 ' +
          (own ? 'cursor-default' : 'hover:bg-muted')
        }
      >
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] ${meta.tone}`}>
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
            <span className="shrink-0 text-[12px] text-ink-soft">{metaOf(entry)}</span>
          </span>
          {entry.module !== 'menu' && entry.summary ? (
            <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-soft">
              {entry.summary}
            </span>
          ) : null}
          {own ? (
            <span className="mt-0.5 block text-[11px] text-ink-soft/80">
              {entry.metadata.createdByName ?? '家庭成员'}创建 · {eventTime(entry)}
            </span>
          ) : null}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {canRemind ? (
          <Link
            to={
              `/schedule/reminders?sourceModule=${entry.module}&sourceId=${entry.sourceId}` +
              (entry.module === 'task' ? `&occurrenceDate=${entry.date}` : '')
            }
            aria-label={`提醒${entry.title}`}
            className="grid size-8 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-accent"
          >
            🔔
          </Link>
        ) : null}
        {canManage ? (
          <>
            <button
              type="button"
              aria-label={`编辑${entry.title}`}
              onClick={onEdit}
              className="grid size-8 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-accent"
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`删除${entry.title}`}
              onClick={onDelete}
              className="grid size-8 place-items-center rounded-lg text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
            >
              🗑
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function CalendarPage() {
  const today = toDateStr(new Date());
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [form, setForm] = useState<{ editing: CalendarEntry | null } | null>(null);
  const [deleting, setDeleting] = useState<CalendarEntry | null>(null);

  const range = useMemo(() => calendarRange(month), [month]);
  const entries = useCalendarEntries(range.start, range.end);
  const remove = useDeleteCalendarEvent();

  // 左栏下面那块：这个月每类各有多少，顺手把空着的一列填上
  const monthStats = useMemo(() => {
    const counts = new Map<CalendarEntry['module'], number>();
    for (const entry of entries.data ?? []) {
      counts.set(entry.module, (counts.get(entry.module) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries.data]);

  const dayEntries = useMemo(
    () => (entries.data ?? []).filter((entry) => entry.date === selected),
    [entries.data, selected],
  );

  return (
    <Page
      title="家庭日历"
      subtitle="吃饭、任务、来访、维护、出行都汇到这儿"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setForm({ editing: null })}>
          + 添加事件
        </Button>
      }
    >
      {/* 左栏：月历按内容高度摆着，下面接一块本月概览，把这一列填满 */}
      <div className="flex min-h-0 flex-col gap-4 lg:w-[360px] lg:flex-none">
        <Panel grow={false} className="p-2">
          <CalendarMonth
            entries={entries.data}
            selectedDate={selected}
            visibleMonth={month}
            onSelect={(date) => {
              setSelected(date);
              const next = startOfMonth(parseDate(date));
              if (next.getTime() !== month.getTime()) setMonth(next);
            }}
            onMonthChange={setMonth}
          />
        </Panel>

        <Panel title={`本月 · 共 ${entries.data?.length ?? 0} 项`} className="hidden lg:flex">
          {monthStats.length ? (
            monthStats.map(([module, count]) => (
              <div
                key={module}
                className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] ${MODULE_META[module].tone}`}>
                  {MODULE_META[module].icon}
                </span>
                <span className="flex-1 text-sm">{MODULE_LABEL[module]}</span>
                <span className="text-sm font-medium tabular-nums">{count}</span>
              </div>
            ))
          ) : (
            <EmptyState emoji="📭" title="这个月还没有安排" />
          )}
        </Panel>
      </div>

      <Panel
        title={`${fullDate(selected)} · ${dayEntries.length ? `${dayEntries.length} 项安排` : '暂无安排'}`}
        right={
          selected === today ? null : (
            <button
              type="button"
              onClick={() => {
                setSelected(today);
                setMonth(startOfMonth(new Date()));
              }}
              className="shrink-0 text-[13px] text-accent hover:underline"
            >
              回今天
            </button>
          )
        }
      >
        {entries.isPending ? (
          <div className="p-3">
            <ListSkeleton rows={4} />
          </div>
        ) : dayEntries.length === 0 ? (
          <EmptyState emoji="🗓" title="这天还没有安排" hint="点右上角添加一个家庭事件" />
        ) : (
          dayEntries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onEdit={() => setForm({ editing: entry })}
              onDelete={() => setDeleting(entry)}
            />
          ))
        )}
      </Panel>

      {form ? (
        <EventForm
          key={form.editing?.id ?? 'new'}
          date={selected}
          editing={form.editing}
          onClose={() => setForm(null)}
        />
      ) : null}

      {deleting ? (
        <Dialog
          title={`删除「${deleting.title}」`}
          onClose={() => setDeleting(null)}
          maxWidth={380}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button
                className="flex-1 bg-danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.sourceId, {
                    onSuccess: () => {
                      pushToast(`已删除「${deleting.title}」`);
                      setDeleting(null);
                    },
                  })
                }
              >
                删除
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-soft">删掉后不可恢复。</p>
        </Dialog>
      ) : null}
    </Page>
  );
}
