import { describe, expect, it } from 'vitest';
import type { TaskOccurrence } from '@family/contracts';
import { pickLinkedOccurrence, readTaskLink, withoutTaskLink } from './task-intent';

const occurrence = (id: string, taskId: string, dueDate: string) => ({ id, taskId, dueDate }) as TaskOccurrence;

describe('pickLinkedOccurrence', () => {
  const items = [occurrence('a', 't1', '2026-09-30'), occurrence('b', 't1', '2026-09-29'), occurrence('c', 't2', '2026-10-01')];

  it('同一件任务出现好几次：今天那一次优先', () => {
    expect(pickLinkedOccurrence(items, 't1', '2026-09-29')?.id).toBe('b');
  });

  it('今天没有就取最早的一次；列表里没有为 null', () => {
    expect(pickLinkedOccurrence(items, 't1', '2026-09-28')?.id).toBe('b');
    expect(pickLinkedOccurrence(items, 't2', '2026-09-29')?.id).toBe('c');
    expect(pickLinkedOccurrence(items, 'missing', '2026-09-29')).toBeNull();
  });
});

describe('pickLinkedOccurrence：带 date（通知的 /tasks?date=&taskId=）', () => {
  const today = '2026-10-08';
  const lastDay = '2026-10-21'; // today + 13
  const daily = [
    occurrence('d0', 't1', '2026-10-08'),
    occurrence('d3', 't1', '2026-10-11'),
    occurrence('d13', 't1', '2026-10-21'),
    occurrence('x3', 't2', '2026-10-11'),
  ];

  it('date 在显示范围里：取那天那一次，不取今天；两端都算范围内', () => {
    expect(pickLinkedOccurrence(daily, 't1', today, { date: '2026-10-11', lastDay })?.id).toBe('d3');
    expect(pickLinkedOccurrence(daily, 't1', today, { date: lastDay, lastDay })?.id).toBe('d13');
    expect(pickLinkedOccurrence(daily, 't1', today, { date: today, lastDay })?.id).toBe('d0');
  });

  it('date 不在显示范围：退回今天优先（每天的家务、通知日是昨天 → 今天那一次）', () => {
    expect(pickLinkedOccurrence(daily, 't1', today, { date: '2026-10-07', lastDay })?.id).toBe('d0');
    expect(pickLinkedOccurrence(daily, 't1', today, { date: '2026-10-22', lastDay })?.id).toBe('d0');
    // 范围外那天就算列表里有，也不当首选
    const withPast = [occurrence('past', 't1', '2026-10-07'), ...daily];
    expect(pickLinkedOccurrence(withPast, 't1', today, { date: '2026-10-07', lastDay })?.id).toBe('d0');
  });

  it('date 在范围但那天没有这件：今天优先，今天也没有就最早一次', () => {
    expect(pickLinkedOccurrence(daily, 't1', today, { date: '2026-10-12', lastDay })?.id).toBe('d0');
    expect(pickLinkedOccurrence(daily, 't2', today, { date: '2026-10-12', lastDay })?.id).toBe('x3');
  });

  it('没有 date：同原规则；列表里没有为 null', () => {
    expect(pickLinkedOccurrence(daily, 't1', today, { date: null, lastDay })?.id).toBe('d0');
    expect(pickLinkedOccurrence(daily, 't2', today, { date: null, lastDay })?.id).toBe('x3');
    expect(pickLinkedOccurrence(daily, 'missing', today, { date: '2026-10-11', lastDay })).toBeNull();
  });
});

describe('readTaskLink / withoutTaskLink', () => {
  const read = (search: string) => readTaskLink(new URLSearchParams(search));

  it('task 和 taskId 都认，同时出现以 task 为准；date 一并读出', () => {
    expect(read('?task=a')).toEqual({ taskId: 'a', date: null });
    expect(read('?date=2026-10-11&taskId=b')).toEqual({ taskId: 'b', date: '2026-10-11' });
    expect(read('?task=a&taskId=b&date=2026-10-11')).toEqual({ taskId: 'a', date: '2026-10-11' });
  });

  it('task 是空串时落到 taskId；date 为空当没带', () => {
    expect(read('?task=&taskId=b')).toEqual({ taskId: 'b', date: null });
    expect(read('?taskId=b&date=')).toEqual({ taskId: 'b', date: null });
  });

  it('只带 date、什么都不带、task 为空且没有 taskId：都不算深链', () => {
    expect(read('?date=2026-10-11')).toBeNull();
    expect(read('')).toBeNull();
    expect(read('?task=&date=2026-10-11')).toBeNull();
  });

  it('抹参数：task / taskId / date 三个一起抹，别的留着，不改原对象', () => {
    const params = new URLSearchParams('?task=a&taskId=b&date=2026-10-11&create=1');
    expect(withoutTaskLink(params).toString()).toBe('create=1');
    expect(params.get('task')).toBe('a');
  });
});
