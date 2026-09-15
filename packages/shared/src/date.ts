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
