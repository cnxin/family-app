import { ValidationError } from './errors';

export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
export const DAY_MS = 86_400_000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 家庭所在时区（Asia/Shanghai）的当天日期，YYYY-MM-DD。 */
export function todayInShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 字符串是否是合法的 YYYY-MM-DD 日期（含月份/日期范围校验）。 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

/**
 * 校验 YYYY-MM-DD 并返回 UTC 零点的时间戳；不合法时抛 ValidationError。
 * 错误文案与旧模块保持一致：`${label}必须使用 YYYY-MM-DD 格式` / `${label}不是有效日期`。
 */
export function parseDateOnly(value: string, label: string): number {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new ValidationError(`${label}必须使用 YYYY-MM-DD 格式`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${label}不是有效日期`);
  }
  return timestamp;
}

/** 在 YYYY-MM-DD 上加减天数，返回 YYYY-MM-DD。 */
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 两个 YYYY-MM-DD 之间相差的整天数（end - start）。 */
export function daysBetween(start: string, end: string): number {
  return Math.round(
    (new Date(`${end}T00:00:00.000Z`).getTime() -
      new Date(`${start}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );
}

/** Date 或 ISO 字符串取日期部分（UTC）。 */
export function dateString(value: Date | string | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** 纯日期比较，不把日期投影为真实时刻。 */
export function compare(left: string, right: string): -1 | 0 | 1 {
  parseDateOnly(left, '日期');
  parseDateOnly(right, '日期');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 两个纯日历日期之间的天数（end - start），跨夏令时仍按日历天计。 */
export function diffDays(start: string, end: string): number {
  parseDateOnly(start, '开始日期');
  parseDateOnly(end, '结束日期');
  return daysBetween(start, end);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function calendarFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** 家庭所在地的日历今天，和执行进程、设备所在时区无关。 */
export function householdToday(timezone: string, now: Date = new Date()): string {
  return calendarFormatter(timezone).format(now);
}

/** 一个月的纯日期区间，[start, end)，右边界是下个月首日。 */
export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('月份必须使用 YYYY-MM 格式');
  const start = `${month}-01`;
  parseDateOnly(start, '月份');
  const [year, index] = month.split('-').map(Number);
  return {
    start,
    end: `${String(year + Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`,
  };
}

/** 家庭指定日开始的真实时刻。只用于日界查询 / 计时，不用于纯日期存储。 */
export function startOfHouseholdDay(timezone: string, date: string): Date {
  parseDateOnly(date, '日期');
  const formatter = calendarFormatter(timezone); // 无效 IANA 时区在此抛 RangeError
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  // IANA 偏移可到 +14/-12，夏令时可能恰在午夜跳变；二分找最早属于目标日的毫秒。
  let low = midnightUtc - 2 * DAY_MS;
  let high = midnightUtc + 2 * DAY_MS;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (formatter.format(new Date(middle)) < date) low = middle + 1;
    else high = middle;
  }
  if (formatter.format(new Date(low)) !== date) {
    throw new RangeError(`${timezone} 的 ${date} 不存在`);
  }
  return new Date(low);
}
