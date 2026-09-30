import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapShape, StorageLocation } from '@family/contracts';
import { api } from '../../lib/api';
import { locationKeys } from '../../lib/queries';
import { pushToast } from '../../lib/toast';
import type { ShapeChange } from './map-types';

const DEBOUNCE = 500;
const LISTS = [locationKeys.list(false), locationKeys.list(true)];

/**
 * 地图编辑器的保存（item-location-plan §3 I2b）：改动先写进缓存（画面立刻是新的），停手 500 ms 后
 * 按顺序 PATCH /locations/:id/shape——房间先、里面的柜子后（服务端按房间的新形状校验柜子）。
 * 失败就把那一块退回改之前的样子并提示；离开页面时把没发出去的立刻发掉。
 */
export function useShapeSaver() {
  const client = useQueryClient();
  const pending = useRef(new Map<string, MapShape | null>());
  /** 每块在这一轮改动之前服务端的形状（回滚用） */
  const committed = useRef(new Map<string, MapShape | null>());
  const timer = useRef<number | undefined>(undefined);
  const running = useRef<Promise<void>>(Promise.resolve());
  /** 给编辑器右上角那行小字：保存中… / 已保存 / 没保存上 */
  const [status, setStatus] = useState<'saved' | 'saving' | 'failed'>('saved');

  const read = useCallback(
    (id: string) => client.getQueryData<StorageLocation[]>(locationKeys.list(false))?.find((one) => one.id === id) ?? null,
    [client],
  );
  const write = useCallback(
    (id: string, shape: MapShape | null) => {
      for (const key of LISTS) {
        client.setQueryData<StorageLocation[]>(key, (list) => list?.map((one) => (one.id === id ? { ...one, mapShape: shape } : one)));
      }
    },
    [client],
  );

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const batch = [...pending.current];
    pending.current.clear();
    if (!batch.length) return running.current;
    const depth = (id: string) => read(id)?.depth ?? 1;
    batch.sort(([a], [b]) => depth(a) - depth(b));
    setStatus('saving');
    running.current = running.current.then(async () => {
      let failed = 0;
      let message = '';
      for (const [id, shape] of batch) {
        try {
          await api<StorageLocation>(`/locations/${id}/shape`, { method: 'PATCH', body: { mapShape: shape } });
          if (!pending.current.has(id)) committed.current.delete(id);
        } catch (error) {
          failed += 1;
          message = error instanceof Error ? error.message : '保存失败';
          if (!pending.current.has(id)) {
            write(id, committed.current.get(id) ?? null);
            committed.current.delete(id);
          }
        }
      }
      if (failed) pushToast(`地图没保存上（${message}），已退回原来的样子`);
      setStatus(failed ? 'failed' : pending.current.size ? 'saving' : 'saved');
    });
    return running.current;
  }, [read, write]);

  const save = useCallback(
    (changes: ShapeChange[] | { id: string; shape: MapShape | null }[]) => {
      for (const { id, shape } of changes) {
        if (!committed.current.has(id)) committed.current.set(id, read(id)?.mapShape ?? null);
        write(id, shape);
        pending.current.set(id, shape);
      }
      window.clearTimeout(timer.current);
      setStatus('saving');
      timer.current = window.setTimeout(() => void flush(), DEBOUNCE);
    },
    [flush, read, write],
  );

  useEffect(() => () => void flush(), [flush]);

  /** 新画的东西要马上落库（不等防抖）：返回保存完成的 Promise */
  const saveNow = useCallback(
    (changes: { id: string; shape: MapShape | null }[]) => {
      save(changes);
      return flush();
    },
    [save, flush],
  );

  return { save, saveNow, flush, status };
}
