import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TaskOccurrence } from '@family/contracts';

/** 深链高亮多久（ia-plan「深链约定」：`task` / `taskId` + `date`） */
export const TASK_HIGHLIGHT_MS = 2_000;

/** 深链的三个参数：处理完一起抹 */
const LINK_PARAMS = ['task', 'taskId', 'date'] as const;

export interface TaskLink {
  taskId: string;
  /** 没带或为空是 null */
  date: string | null;
}

/**
 * 读深链：`task`（留意卡）优先，其次 `taskId`（后端通知、日历、提醒、动态、小管家写的 targetPath）。
 * 用 `||` 不用 `??`：`?task=&taskId=X` 时空的 task 不该挡住 taskId。两个都没有（比如只带 `?date=`）不算深链，返回 null。
 */
export function readTaskLink(params: URLSearchParams): TaskLink | null {
  const taskId = params.get('task') || params.get('taskId');
  return taskId ? { taskId, date: params.get('date') || null } : null;
}

/** 处理完抹参数：task / taskId / date 三个一起抹，其余参数原样留着；不改传进来的对象。 */
export function withoutTaskLink(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  for (const name of LINK_PARAMS) next.delete(name);
  return next;
}

/**
 * 同一件任务可能在两周里出现好几次。`date` 落在任务页的显示范围（today～lastDay，含两端）里，就先取那天那一次；
 * 没带、不在范围、或那天没有这件时，退回原规则：今天那一次优先，其次最早的一次。
 */
export function pickLinkedOccurrence(
  items: TaskOccurrence[],
  taskId: string,
  today: string,
  prefer?: { date: string | null; lastDay: string },
) {
  const matches = items.filter((item) => item.taskId === taskId);
  const date = prefer?.date && prefer.date >= today && prefer.date <= prefer.lastDay ? prefer.date : null;
  return (
    (date ? matches.find((item) => item.dueDate === date) : undefined) ??
    matches.find((item) => item.dueDate === today) ??
    matches.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ??
    null
  );
}

/**
 * 读 ?task=<id> 或 ?taskId=<id>&date=<d>：列表到了就滚到那一次、高亮 2 秒，然后把三个参数一起从 URL 抹掉。
 * 列表里没有（过期、删了、读失败）也抹掉，不报错；只带 ?date= 不碰。返回此刻要高亮的那一次（occurrence id）。
 */
export function useTaskIntent(items: TaskOccurrence[] | undefined, settled: boolean, today: string, lastDay: string) {
  const [params, setParams] = useSearchParams();
  const link = readTaskLink(params);
  const linkKey = link ? `${link.taskId}|${link.date ?? ''}` : null;
  const [highlight, setHighlight] = useState<{ id: string; for: string } | null>(null);
  if (link && linkKey && settled && highlight?.for !== linkKey) {
    const target = items ? pickLinkedOccurrence(items, link.taskId, today, { date: link.date, lastDay }) : null;
    setHighlight({ id: target?.id ?? '', for: linkKey });
  }
  const active = highlight?.id || null;
  useEffect(() => {
    if (!linkKey || !highlight || highlight.for !== linkKey) return;
    if (highlight.id) {
      document.querySelector(`[data-task-occurrence="${CSS.escape(highlight.id)}"]`)?.scrollIntoView({ block: 'center' });
    }
    setParams(withoutTaskLink(params), { replace: true });
  }, [highlight, linkKey, params, setParams]);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setHighlight((current) => (current ? { ...current, id: '' } : current)), TASK_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active;
}
