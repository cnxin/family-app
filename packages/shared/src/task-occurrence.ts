import { parseDateOnly } from './date';

// J1b：从 apps/api/src/tasks 搬来的纯函数（原样），提醒也要用它判断「这天有没有这次任务」，
// 不再跨插件 import 任务目录。只看任务的重复规则，不查库。

const DAY_MS = 86_400_000;

/** 判断一件任务在某天是否发生所需的字段（HouseholdTask 实体与契约对象都满足）。 */
export interface TaskRecurrenceRule {
  startsOn: string;
  endsOn: string | null;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
  repeatInterval: number;
}

export function taskOccursOn(task: TaskRecurrenceRule, date: string) {
  const startsAt = parseDateOnly(task.startsOn, '开始日期');
  const dueAt = parseDateOnly(date, '任务日期');
  if (dueAt < startsAt) return false;
  if (task.endsOn && dueAt > parseDateOnly(task.endsOn, '结束日期')) {
    return false;
  }
  const differenceDays = Math.round((dueAt - startsAt) / DAY_MS);
  if (task.recurrence === 'once') return differenceDays === 0;
  if (task.recurrence === 'daily') {
    return differenceDays % task.repeatInterval === 0;
  }
  if (task.recurrence === 'weekly') {
    return differenceDays % (task.repeatInterval * 7) === 0;
  }
  const starts = task.startsOn.split('-').map(Number);
  const due = date.split('-').map(Number);
  const monthDifference =
    (due[0] - starts[0]) * 12 + (due[1] - starts[1]);
  return due[2] === starts[2] && monthDifference % task.repeatInterval === 0;
}
