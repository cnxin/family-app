import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CalendarEntry } from '@family/contracts';
import {
  calendarRange,
  parseDate,
  shiftMonth,
  startOfMonth,
  toDateStr,
} from '../components/calendar-month';
import { AgendaFlow, MODULE_ICON, MonthBoard, WeekColumns } from '../components/calendar-views';
import { EventForm } from '../components/event-form';
import { useCalendarEntries, useDeleteCalendarEvent } from '../lib/queries';
import { legacyUrl } from '../lib/nav';
import { pushToast } from '../lib/toast';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';
import { ListSkeleton } from '../components/skeleton';

type View = 'month' | 'week' | 'agenda';

const VIEW_KEY = 'family-app.calendar-view';

/**
 * 没指定视图时：桌面默认「月」——宽屏要的是空间感，一眼看完整月分布；
 * 手机默认「流」——一屏放不下七列也画不清月格，按天往下滚最顺。
 * 选过之后记住选择（只存在这台设备上，读写都包 try/catch，隐私模式下会抛）。
 */
function defaultView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'month' || saved === 'week' || saved === 'agenda') return saved;
  } catch {
    /* 隐私模式读不到就按屏幕来 */
  }
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    ? 'month'
    : 'agenda';
}

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

/** 右侧那行小字：每类来源最该先看到的一句，照旧客户端 ScheduleRow 的分法。 */
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

/** 已搬的域走新客户端，没搬的用契约给的 targetPath 回旧版。 */
function useOpenEntry() {
  const navigate = useNavigate();
  return (entry: CalendarEntry) => {
    if (entry.module === 'menu') navigate(`/eat/kitchen?date=${entry.date}`);
    else if (entry.module === 'task') navigate('/schedule/tasks');
    else if (entry.module === 'calendar') return;
    else window.open(legacyUrl(entry.targetPath), '_blank', 'noopener');
  };
}

/** 一条安排的完整一行：用在「某天」的弹层和「流」视图里。 */
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
  const own = entry.module === 'calendar';
  const canManage = own && Boolean(entry.metadata.canManage);
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
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[13px]">
          {MODULE_ICON[entry.module]}
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

function startOfWeek(date: Date) {
  const day = new Date(date);
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

export function CalendarPage() {
  const today = toDateStr(new Date());
  const [params, setParams] = useSearchParams();
  const [fallbackView] = useState(defaultView);
  const view = (params.get('view') as View | null) ?? fallbackView;
  const [anchor, setAnchor] = useState(() => new Date());
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: CalendarEntry | null } | null>(null);
  const [deleting, setDeleting] = useState<CalendarEntry | null>(null);

  // 每种视图要的区间不一样：月看六周、周看七天、流看往后一个月
  const range = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start: toDateStr(start), end: toDateStr(end) };
    }
    if (view === 'agenda') {
      const end = new Date();
      end.setDate(end.getDate() + 45);
      return { start: today, end: toDateStr(end) };
    }
    return calendarRange(startOfMonth(anchor));
  }, [view, anchor, today]);

  const entries = useCalendarEntries(range.start, range.end);
  const remove = useDeleteCalendarEvent();
  const rows = entries.data ?? [];

  const dayRows = useMemo(
    () => (dayOpen ? rows.filter((entry) => entry.date === dayOpen) : []),
    [rows, dayOpen],
  );

  const step = (offset: number) => {
    if (view === 'week') {
      const next = new Date(anchor);
      next.setDate(next.getDate() + offset * 7);
      setAnchor(next);
    } else {
      setAnchor(shiftMonth(startOfMonth(anchor), offset));
    }
  };

  const periodLabel =
    view === 'week'
      ? (() => {
          const start = startOfWeek(anchor);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          return `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
        })()
      : `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;

  return (
    <Page
      title="家庭日历"
      subtitle="吃饭、任务、来访、维护、出行都汇到这儿"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setForm({ editing: null })}>
          + 添加事件
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={view}
            onChange={(next) => {
              try {
                localStorage.setItem(VIEW_KEY, next);
              } catch {
                /* 存不下不影响这次切换 */
              }
              setParams({ view: next }, { replace: true });
            }}
            options={[
              { value: 'month' as const, label: '月' },
              { value: 'week' as const, label: '周' },
              { value: 'agenda' as const, label: '流' },
            ]}
          />
          {view === 'agenda' ? null : (
            <>
              <button
                type="button"
                aria-label="上一段"
                onClick={() => step(-1)}
                className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
              >
                ‹
              </button>
              <span className="min-w-[7.5rem] text-center text-sm font-medium">{periodLabel}</span>
              <button
                type="button"
                aria-label="下一段"
                onClick={() => step(1)}
                className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
              >
                ›
              </button>
              <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => setAnchor(new Date())}>
                回今天
              </Button>
            </>
          )}
          <span className="ml-auto text-[12px] text-ink-soft">共 {rows.length} 项</span>
        </div>
      }
    >
      <Panel>
        {entries.isPending ? (
          <div className="p-3">
            <ListSkeleton rows={6} />
          </div>
        ) : view === 'month' ? (
          <MonthBoard
            entries={rows}
            visibleMonth={startOfMonth(anchor)}
            selectedDate={dayOpen ?? ''}
            onSelect={setDayOpen}
            onOpen={(entry) => setDayOpen(entry.date)}
          />
        ) : view === 'week' ? (
          <WeekColumns
            entries={rows}
            weekStart={startOfWeek(anchor)}
            onOpen={(entry) => setDayOpen(entry.date)}
          />
        ) : (
          <AgendaFlow entries={rows} onOpen={(entry) => setDayOpen(entry.date)} />
        )}
      </Panel>

      {dayOpen ? (
        <Dialog title={fullDate(dayOpen)} onClose={() => setDayOpen(null)} maxWidth={520}>
          {dayRows.length ? (
            <div className="-mx-4 -my-4">
              {dayRows.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => {
                    setDayOpen(null);
                    setForm({ editing: entry });
                  }}
                  onDelete={() => {
                    setDayOpen(null);
                    setDeleting(entry);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptyState emoji="🗓" title="这天还没有安排" hint="点右上角添加一个家庭事件" />
          )}
        </Dialog>
      ) : null}

      {form ? (
        <EventForm
          key={form.editing?.id ?? 'new'}
          date={dayOpen ?? today}
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
