import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TaskOccurrence } from '@family/contracts';

/** 深链高亮多久（ia-plan「深链约定」：`task`） */
export const TASK_HIGHLIGHT_MS = 2_000;

/** 同一件任务可能在两周里出现好几次：今天那一次优先，其次最早的一次。 */
export function pickLinkedOccurrence(items: TaskOccurrence[], taskId: string, today: string) {
  const matches = items.filter((item) => item.taskId === taskId);
  return matches.find((item) => item.dueDate === today) ?? matches.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
}

/**
 * 读 ?task=<id>：列表到了就滚到这件、高亮 2 秒，然后把参数从 URL 抹掉（只动这一个参数）。
 * 列表里没有（过期、删了、读失败）也抹掉，不报错。返回此刻要高亮的那一次（occurrence id）。
 */
export function useTaskIntent(items: TaskOccurrence[] | undefined, settled: boolean, today: string) {
  const [params, setParams] = useSearchParams();
  const linked = params.get('task');
  const [highlight, setHighlight] = useState<{ id: string; for: string } | null>(null);
  if (linked && settled && highlight?.for !== linked) {
    const target = items ? pickLinkedOccurrence(items, linked, today) : null;
    setHighlight({ id: target?.id ?? '', for: linked });
  }
  const active = highlight?.id || null;
  useEffect(() => {
    if (!linked || !highlight || highlight.for !== linked) return;
    if (highlight.id) {
      document.querySelector(`[data-task-occurrence="${CSS.escape(highlight.id)}"]`)?.scrollIntoView({ block: 'center' });
    }
    const next = new URLSearchParams(params);
    next.delete('task');
    setParams(next, { replace: true });
  }, [highlight, linked, params, setParams]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setHighlight((current) => (current ? { ...current, id: '' } : current)), TASK_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active;
}
