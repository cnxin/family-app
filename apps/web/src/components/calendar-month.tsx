import { useMemo } from 'react';
import type { CalendarEntry } from '@family/contracts';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function toDateStr(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

export function shiftMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
}

/** 固定六周 42 格，周一起头——月份换来换去时格子数不变，网格不会跳高跳矮。 */
export function calendarDays(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function calendarRange(month: Date) {
  const days = calendarDays(month);
  return { start: toDateStr(days[0]), end: toDateStr(days[days.length - 1]) };
}

interface Marker {
  menu: number;
  task: number;
  event: number;
  other: number;
}

/**
 * 日格上的标记照旧客户端的分法：菜单显示道数（数字比点有用——今天几个菜是要看的），
 * 其余按来源分色点。点多了就成了噪音，所以最多三个点，剩下的用「+n」收掉。
 */
export function CalendarMonth({
  entries = [],
  selectedDate,
  visibleMonth,
  onSelect,
  onMonthChange,
}: {
  entries?: CalendarEntry[];
  selectedDate: string;
  visibleMonth: Date;
  onSelect: (date: string) => void;
  onMonthChange: (month: Date) => void;
}) {
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const today = toDateStr(new Date());

  const markers = useMemo(() => {
    const map = new Map<string, Marker>();
    for (const entry of entries) {
      const current = map.get(entry.date) ?? { menu: 0, task: 0, event: 0, other: 0 };
      if (entry.module === 'menu') current.menu += entry.metadata.itemCount ?? 0;
      else if (entry.module === 'task') current.task += 1;
      else if (entry.module === 'calendar') current.event += 1;
      else current.other += 1;
      map.set(entry.date, current);
    }
    return map;
  }, [entries]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 px-1">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => onMonthChange(shiftMonth(visibleMonth, -1))}
          className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
        >
          ‹
        </button>
        <span className="flex-1 text-center text-sm font-semibold">
          {visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月
        </span>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => onMonthChange(shiftMonth(visibleMonth, 1))}
          className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 px-1 pb-1">
        {WEEKDAYS.map((weekday, index) => (
          <span
            key={weekday}
            className={
              'text-center text-[11px] ' + (index > 4 ? 'text-warm' : 'text-ink-soft')
            }
          >
            {weekday}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 px-1 pb-1">
        {days.map((day) => {
          const value = toDateStr(day);
          const selected = value === selectedDate;
          const isToday = value === today;
          const outside = day.getMonth() !== visibleMonth.getMonth();
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const marker = markers.get(value);
          const dots = marker
            ? [
                marker.event ? 'bg-accent' : '',
                marker.task ? 'bg-warm' : '',
                marker.other ? 'bg-ink-soft' : '',
              ].filter(Boolean)
            : [];

          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              aria-label={`${day.getMonth() + 1}月${day.getDate()}日${
                marker?.menu ? `，${marker.menu} 道菜` : ''
              }`}
              onClick={() => onSelect(value)}
              className={
                'relative flex aspect-square flex-col items-center justify-center rounded-lg ' +
                'text-[13px] transition-colors duration-150 ' +
                (selected
                  ? 'bg-accent font-semibold text-white'
                  : isToday
                    ? 'border border-accent font-semibold hover:bg-muted'
                    : 'hover:bg-muted') +
                (selected
                  ? ''
                  : outside
                    ? ' text-ink-soft/50'
                    : weekend
                      ? ' text-warm'
                      : ' text-ink')
              }
            >
              <span>{day.getDate()}</span>

              {dots.length ? (
                <span className="mt-0.5 flex gap-[3px]">
                  {dots.map((tone) => (
                    <span
                      key={tone}
                      className={`size-1 rounded-full ${selected ? 'bg-white/80' : tone}`}
                    />
                  ))}
                </span>
              ) : (
                <span className="mt-0.5 h-1" />
              )}

              {marker?.menu ? (
                <span
                  className={
                    'absolute -right-0.5 -top-0.5 grid min-w-[15px] place-items-center rounded-full ' +
                    'px-[3px] text-[9px] font-semibold leading-[15px] ' +
                    (selected ? 'bg-white text-accent' : 'bg-warm text-white')
                  }
                >
                  {marker.menu > 9 ? '9+' : marker.menu}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
