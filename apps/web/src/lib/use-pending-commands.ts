import { useCallback, useEffect, useRef, useState } from 'react';
import type { SmartHomeAction } from '@family/contracts';
import { useSmartHomeEntityCommand } from './queries';
import { PENDING_TIMEOUT_MS, releasedEntities, type PendingEntry } from './smart-home-controls';
import { pushToast } from './toast';

type Entry = PendingEntry & { failed?: boolean; timedOut?: boolean };

/**
 * 详情面板发命令的节奏（smart-home-redesign §9.6）：每个子实体一把锁。发出后这个实体的控件置灰转圈，
 * 直到它的状态回推（lastUpdated 变了）或 8 秒超时；HA 回 502 立即解锁（原因由全局错误提示弹）。
 * 每次发出一个新的 requestId（幂等键），网络重发用同一个；同一台设备的其他控件照常能按。
 * 锁是否还在由渲染时推导（记的是发出时的 lastUpdated），不在 effect 里改状态。
 */
export function usePendingCommands(deviceId: string, lastUpdated: Record<string, string | null | undefined>) {
  const command = useSmartHomeEntityCommand(deviceId);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const latest = useRef(lastUpdated);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    latest.current = lastUpdated;
  }, [lastUpdated]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const timer of all.values()) clearTimeout(timer);
      all.clear();
    };
  }, []);

  const released = new Set(releasedEntities(entries, lastUpdated));
  const isPending = (entityId: string) => {
    const entry = entries[entityId];
    return Boolean(entry && !entry.failed && !entry.timedOut && !released.has(entityId));
  };

  const finish = useCallback((entityId: string, requestId: string, patch: Partial<Entry>) => {
    const timer = timers.current.get(entityId);
    if (timer) clearTimeout(timer);
    timers.current.delete(entityId);
    setEntries((current) =>
      current[entityId]?.requestId === requestId ? { ...current, [entityId]: { ...current[entityId], ...patch } } : current,
    );
  }, []);

  const send = (entityId: string, action: SmartHomeAction, value?: string | number | string[]) => {
    if (isPending(entityId)) return false;
    const entry: Entry = { requestId: crypto.randomUUID(), baseline: lastUpdated[entityId] ?? null, value };
    setEntries((current) => ({ ...current, [entityId]: entry }));
    const old = timers.current.get(entityId);
    if (old) clearTimeout(old);
    timers.current.set(
      entityId,
      setTimeout(() => {
        const stillWaiting = releasedEntities({ [entityId]: entry }, latest.current).length === 0;
        finish(entityId, entry.requestId, { timedOut: true });
        if (stillWaiting) pushToast('没等到设备回报，过会儿看看状态');
      }, PENDING_TIMEOUT_MS),
    );
    command.mutate(
      { entityId, action, value, requestId: entry.requestId },
      {
        // 命令已被 HA 接受：给一下轻触感；锁等状态回推再放
        onSuccess: () => navigator.vibrate?.(10),
        onError: () => finish(entityId, entry.requestId, { failed: true }),
      },
    );
    return true;
  };

  return {
    send,
    isPending,
    pendingValue: (entityId: string) => (isPending(entityId) ? entries[entityId].value : undefined),
  };
}

export type PendingCommands = ReturnType<typeof usePendingCommands>;
