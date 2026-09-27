import { useMemo } from 'react';
import type { CalendarEntry } from '@family/contracts';
import { calendarDays, toDateStr } from './calendar-month';
import { EmptyState } from './ui';

/**
 * 三种日历视图，读同一份数据，只是把它摆成不同形状：
 * - 月：大格月历，事件直接写在格子里（看一个月的分布）
 * - 周：一周七列清单（看这一周谁忙、哪天满）
 * - 流：按天往下滚的议程（看接下来会发生什么）
 * 之前那版是「小月历 + 只看选中那一天」，一天两条就撑不起一屏，问题出在形状上。
 */

export const MODULE_TONE: Record<CalendarEntry['module'], string> = {
  menu: 'bg-warm',
  calendar: 'bg-accent',
  task: 'bg-ink-soft',
  media: 'bg-ink-soft',
  guest: 'bg-ink-soft',
  maintenance: 'bg-ink-soft',
  travel: 'bg-ink-soft',
};

export const MODULE_ICON: Record<CalendarEntry['module'], string> = {
  menu: '🍲',
  calendar: '📅',
  task: '✅',
  media: '🎬',
  guest: '👋',
  maintenance: '🔧',
  travel: '✈️',
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function byDate(entries: CalendarEntry[]) {
  const map = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
  }
  return map;
}

function timeLabel(entry: CalendarEntry) {
  if (!entry.startsAt) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(entry.startsAt));
}

/** 一条事件的紧凑样式：一个色点 + 标题，放得进格子里。 */
function EntryChip({
  entry,
  onOpen,
}: {
  entry: CalendarEntry;
  onOpen: (entry: CalendarEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(entry);
      }}
      title={entry.title}
      className="flex w-full items-center gap-1.5 rounded px-1 py-[3px] text-left text-[12px] transition-colors duration-150 hover:bg-muted"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${MODULE_TONE[entry.module]}`} />
      <span className="truncate">{entry.title}</span>
    </button>
  );
}

// ---- 月：大格月历，事件写在格子里 ---------------------------------------------

export function MonthBoard({
  entries,
  visibleMonth,
  selectedDate,
  onSelect,
  onOpen,
}: {
  entries: CalendarEntry[];
  visibleMonth: Date;
  selectedDate: string;
  onSelect: (date: string) => void;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const map = useMemo(() => byDate(entries), [entries]);
  const today = toDateStr(new Date());

  return (
    <div className="flex h-full min-h-[520px] flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS.map((weekday, index) => (
          <span
            key={weekday}
            className={
              'py-1.5 text-center text-[11px] ' +
              (index > 4 ? 'text-warm' : 'text-ink-soft')
            }
          >
            {weekday}
          </span>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const value = toDateStr(day);
          const list = map.get(value) ?? [];
          const outside = day.getMonth() !== visibleMonth.getMonth();
          const isToday = value === today;
          const selected = value === selectedDate;

          return (
            <div
              key={value}
              role="button"
              tabIndex={0}
              aria-label={`${day.getMonth() + 1}月${day.getDate()}日，${list.length} 项`}
              onClick={() => onSelect(value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(value);
                }
              }}
              className={
                'flex min-h-0 cursor-pointer flex-col items-stretch gap-0.5 border-b border-r border-border p-1 text-left ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                'transition-colors duration-150 last:border-r-0 ' +
                (selected ? 'bg-accent-soft/50' : outside ? 'bg-muted/30' : 'hover:bg-muted/60')
              }
            >
              <span className="flex shrink-0 items-center gap-1 px-1">
                <span
                  className={
                    'grid size-5 place-items-center rounded-full text-[11px] ' +
                    (isToday
                      ? 'bg-accent font-semibold text-white'
                      : outside
                        ? 'text-ink-soft/50'
                        : 'text-ink')
                  }
                >
                  {day.getDate()}
                </span>
                {list.length > 3 ? (
                  <span className="ml-auto text-[10px] text-ink-soft">{list.length}</span>
                ) : null}
              </span>

              <span className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
                {list.slice(0, 3).map((entry) => (
                  <EntryChip key={entry.id} entry={entry} onOpen={onOpen} />
                ))}
                {list.length > 3 ? (
                  <span className="px-1 text-[11px] text-ink-soft">还有 {list.length - 3} 项</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 周：一周七列清单 ---------------------------------------------------------

export function WeekColumns({
  entries,
  weekStart,
  onOpen,
}: {
  entries: CalendarEntry[];
  weekStart: Date;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const map = useMemo(() => byDate(entries), [entries]);
  const today = toDateStr(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });

  return (
    <div className="grid h-full min-h-[520px] grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
      {days.map((day) => {
        const value = toDateStr(day);
        const list = (map.get(value) ?? [])
          .slice()
          .sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
        const isToday = value === today;
        const weekend = day.getDay() === 0 || day.getDay() === 6;

        return (
          <div key={value} className="flex min-h-0 flex-col border-b border-r border-border last:border-r-0">
            <div
              className={
                'flex shrink-0 items-baseline gap-1.5 border-b border-border px-2.5 py-2 ' +
                (isToday ? 'bg-accent-soft' : '')
              }
            >
              <span className={'text-[15px] font-semibold ' + (weekend ? 'text-warm' : '')}>
                {day.getDate()}
              </span>
              <span className="text-[11px] text-ink-soft">周{WEEKDAYS[(day.getDay() + 6) % 7]}</span>
              {list.length ? (
                <span className="ml-auto text-[11px] text-ink-soft">{list.length}</span>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
              {list.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-bg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px]">{MODULE_ICON[entry.module]}</span>
                    <span className="truncate text-[12px] font-medium">{entry.title}</span>
                  </span>
                  {entry.summary || timeLabel(entry) ? (
                    <span className="truncate text-[11px] text-ink-soft">
                      {timeLabel(entry) ? `${timeLabel(entry)} · ` : ''}
                      {entry.summary ?? ''}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- 流：按天往下滚的议程 -----------------------------------------------------

export function AgendaFlow({
  entries,
  onOpen,
  renderActions,
}: {
  entries: CalendarEntry[];
  onOpen: (entry: CalendarEntry) => void;
  renderActions?: (entry: CalendarEntry) => React.ReactNode;
}) {
  const today = toDateStr(new Date());
  const groups = useMemo(() => {
    const map = byDate(entries.filter((entry) => entry.date >= today));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, today]);

  if (!groups.length) {
    return <EmptyState emoji="🗓" title="接下来没有安排" hint="点右上角添加一个家庭事件" />;
  }

  return (
    <div>
      {groups.map(([date, list]) => {
        const day = new Date(`${date}T12:00:00`);
        const isToday = date === today;
        return (
          <section key={date}>
            {/* 日期头吸顶：一直往下滚的时候，随时知道看到哪天了 */}
            <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border bg-surface/90 px-3.5 py-1.5 backdrop-blur">
              <span className={'text-[13px] font-semibold ' + (isToday ? 'text-accent' : '')}>
                {isToday ? '今天' : `${day.getMonth() + 1} 月 ${day.getDate()} 日`}
              </span>
              <span className="text-[11px] text-ink-soft">
                周{WEEKDAYS[(day.getDay() + 6) % 7]} · {list.length} 项
              </span>
            </div>
            {list.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[13px]">
                  {MODULE_ICON[entry.module]}
                </span>
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium">{entry.title}</span>
                  {entry.summary ? (
                    <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                      {entry.summary}
                    </span>
                  ) : null}
                </button>
                {timeLabel(entry) ? (
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                    {timeLabel(entry)}
                  </span>
                ) : null}
                {renderActions?.(entry)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
