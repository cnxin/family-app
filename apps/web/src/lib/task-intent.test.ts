import { describe, expect, it } from 'vitest';
import type { TaskOccurrence } from '@family/contracts';
import { pickLinkedOccurrence } from './task-intent';

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
