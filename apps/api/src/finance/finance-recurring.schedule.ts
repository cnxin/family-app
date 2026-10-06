import { addDays, householdToday, parseDateOnly } from '@family/shared';
import type { FinanceRecurringCadence } from '../entities';

// K3 周期账单的日期推算（docs/finance-plan.md §2.4、§3-K3）。纯函数，单测见 scripts/finance-recurring.check.ts。
// 每一期都从 anchorOn 按序号算，不从上一期往后推：1 月 31 日起的月付是 2 月 28 日、3 月 31 日，不会一路变成 28 日。

const MONTHS: Record<Exclude<FinanceRecurringCadence, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** 自动记账在家庭当地每天几点之后落当天到期的那一期。 */
export const RECURRING_POST_HOUR = 6;
/** 非自动记账的到期前几天进留意、可以点「已付」。 */
export const RECURRING_NOTICE_DAYS = 3;
/** K4 信用卡还款日前几天进留意（还欠着钱时）。 */
export const CREDIT_NOTICE_DAYS = 3;

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** 第 index 期（从 0 起）的应付日。 */
export function occurrenceAt(anchorOn: string, cadence: FinanceRecurringCadence, index: number): string {
  parseDateOnly(anchorOn, '第一次应付日');
  if (cadence === 'weekly') return addDays(anchorOn, index * 7);
  const [year, month, day] = anchorOn.split('-').map(Number);
  const total = month - 1 + index * MONTHS[cadence];
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  return `${pad(targetYear, 4)}-${pad(targetMonth + 1)}-${pad(Math.min(day, daysInMonth(targetYear, targetMonth)))}`;
}

/** 每月 day 号（短月按月末）里不早于 date 的那一天：K4 信用卡这个月的还款日过了就是下个月的。 */
export function nextMonthlyDayOnOrAfter(date: string, day: number): string {
  parseDateOnly(date, '日期');
  const [year, month] = date.split('-').map(Number);
  const thisMonth = `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month - 1)))}`;
  if (thisMonth >= date) return thisMonth;
  const nextYear = month === 12 ? year + 1 : year;
  const nextIndex = month % 12;
  return `${pad(nextYear, 4)}-${pad(nextIndex + 1)}-${pad(Math.min(day, daysInMonth(nextYear, nextIndex)))}`;
}

/** 不早于 date 的第一期（anchorOn 本身在 date 之后就是 anchorOn）。 */
export function firstOccurrenceOnOrAfter(anchorOn: string, cadence: FinanceRecurringCadence, date: string): string {
  if (anchorOn >= date) return anchorOn;
  // 先按天数粗估一个序号再逐期往后挪，避免长周期从 0 开始一期期数。按每月 31 天估，估出来只会偏小，往后挪就行
  const approxDays = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchorOn}T00:00:00Z`)) / 86_400_000;
  const periodDays = cadence === 'weekly' ? 7 : MONTHS[cadence] * 31;
  let index = Math.max(0, Math.floor(approxDays / periodDays) - 2);
  while (occurrenceAt(anchorOn, cadence, index) < date) index += 1;
  return occurrenceAt(anchorOn, cadence, index);
}

/** date 之后的下一期（严格大于）。 */
export function nextOccurrenceAfter(anchorOn: string, cadence: FinanceRecurringCadence, date: string): string {
  return firstOccurrenceOnOrAfter(anchorOn, cadence, addDays(date, 1));
}

/**
 * 自动记账此刻能落到哪一天为止：家庭当地 06:00 之后是今天，之前是昨天。
 * 等价于「把此刻往前推 6 小时再取家庭当地日期」。
 */
export function postingCutoff(timezone: string, now: Date): string {
  return householdToday(timezone, new Date(now.getTime() - RECURRING_POST_HOUR * 3_600_000));
}

/** 折成每月多少钱（汇总页「固定支出」）：周付 × 52 ÷ 12，季付 ÷ 3，年付 ÷ 12；两位小数。 */
export function monthlyAverage(amount: number, cadence: FinanceRecurringCadence): number {
  const monthly =
    cadence === 'weekly' ? (amount * 52) / 12 : cadence === 'monthly' ? amount : amount / MONTHS[cadence];
  return Math.round(monthly * 100) / 100;
}

/** 这一期落的流水的幂等键：同一期无论自动落、手点「已付」还是补跑，都只有一笔。 */
export function recurringIdempotencyKey(recurringId: string, dueOn: string): string {
  return `recurring:${recurringId}:${dueOn}`;
}
