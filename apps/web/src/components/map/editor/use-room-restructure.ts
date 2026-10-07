import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapShape, MergeLocationResult, SplitLocationResult, StorageLocation } from '@family/contracts';
import { pointInShape, polygonArea, shapeBounds, shapePoints, shapesTouch, splitPolygon, straightenLine, type MapPoint } from '@family/shared';
import { ApiError, api } from '../../../lib/api';
import { mergeRooms } from '../../../lib/floorplan/merge-rooms';
import { locationKeys } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import { subtreeOf } from './shape-actions';

// 拆分 / 合并房间（地图编辑器 v2 §2.3、§2.4）：只在电脑上；不进撤销栈，先弹确认框写清后果（拍板 2）。
// 拆：「更多 → 拆分」→ 从墙到墙拖一条线 → 大块留给原房间、小块高亮 → 起名确认 → POST /locations/:id/split。
// 合：「更多 → 合并到…」→ 挨着的房间高亮 → 点一间 → 确认 → 两块求并 → POST /locations/:id/merge（拍板 3：东西全改记到目标）。

export interface SplitPlan {
  room: StorageLocation;
  keep: MapPoint[];
  piece: MapPoint[];
  consequence: string;
}

interface Deps {
  locations: StorageLocation[];
  viewBox: { w: number; h: number };
  snap: boolean;
  select: (id: string | null) => void;
  confirm: (dialog: { title: string; body: string; action: string; run: () => void }) => void;
}

const centre = (shape: MapShape): MapPoint => {
  const b = shapeBounds(shape);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};

export function useRoomRestructure({ locations, viewBox, snap, select, confirm }: Deps) {
  const client = useQueryClient();
  const [splitting, setSplitting] = useState<string | null>(null);
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map(locations.map((one) => [one.id, one]));
  const refresh = () => client.invalidateQueries({ queryKey: locationKeys.all });
  const fail = (error: unknown) => pushToast(error instanceof ApiError ? error.message : '没做成，检查一下网络', undefined, 'error');

  const candidates = (sourceId: string) => {
    const source = byId.get(sourceId);
    if (!source?.mapShape) return [];
    return locations.filter(
      (one) => one.kind === 'room' && one.id !== sourceId && one.mapShape && !one.archivedAt && !one.systemKey && shapesTouch(source.mapShape!, one.mapShape, 12),
    );
  };

  const onLine = (start: MapPoint, end: MapPoint) => {
    const room = splitting ? byId.get(splitting) : null;
    setSplitting(null);
    if (!room?.mapShape) return;
    const [a, b] = snap ? straightenLine(start, end) : [start, end];
    const pieces = splitPolygon(shapePoints(room.mapShape), a, b);
    if (!pieces) {
      pushToast('线要从一面墙画到另一面墙');
      return;
    }
    const [keep, piece] = [...pieces].sort((p, q) => polygonArea(q) - polygonArea(p));
    const moving = locations.filter(
      (one) => one.parentId === room.id && !one.archivedAt && one.mapShape && pointInShape(centre(one.mapShape), { type: 'polygon', points: piece }),
    );
    const parts = [`大的一块还是「${room.name}」，高亮的那块建成新房间。`];
    if (moving.length) parts.push(`${moving.length} 个柜子（${moving.map((one) => one.name).join('、')}）按位置归到新房间。`);
    if (room.itemCount) parts.push(`直接记在「${room.name}」上的 ${room.itemCount} 件东西留在「${room.name}」。`);
    parts.push('拆分后不能撤销。');
    setPlan({ room, keep, piece, consequence: parts.join('') });
  };

  const confirmSplit = async (name: string) => {
    if (!plan) return;
    setBusy(true);
    try {
      const result = await api<SplitLocationResult>(`/locations/${plan.room.id}/split`, {
        method: 'POST',
        body: { shape: { type: 'polygon', points: plan.keep }, newRoom: { name, shape: { type: 'polygon', points: plan.piece } } },
      });
      await refresh();
      setPlan(null);
      select(result.created.id);
      pushToast(`拆出了「${name}」`, undefined, 'success');
      navigator.vibrate?.(12);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const startMerge = (room: StorageLocation) => {
    if (!candidates(room.id).length) pushToast('旁边没有挨着的房间');
    else setMerging(room.id);
  };

  /** 合并时点了一间：是挨着的就弹确认框，别的就算取消 */
  const pickTarget = (targetId: string | null) => {
    const source = merging ? byId.get(merging) : null;
    setMerging(null);
    const target = targetId ? byId.get(targetId) : null;
    if (!source?.mapShape || !target?.mapShape || !candidates(source.id).some((one) => one.id === target.id)) return;
    const below = subtreeOf(locations, source.id);
    const direct = below.filter((one) => one.parentId === source.id).length;
    const things = [source, ...below].reduce((sum, one) => sum + one.itemCount, 0);
    const what = [direct ? `${direct} 个柜子` : '', things ? `${things} 件东西` : ''].filter(Boolean).join('和');
    confirm({
      title: `把「${source.name}」并进「${target.name}」？`,
      body: `${what ? `「${source.name}」里的${what}将改记到「${target.name}」，` : ''}「${source.name}」归档、从图上消失。合并后不能撤销。`,
      action: '合并',
      run: () =>
        void (async () => {
          try {
            const shape = mergeRooms(shapePoints(target.mapShape!), shapePoints(source.mapShape!), viewBox);
            await api<MergeLocationResult>(`/locations/${source.id}/merge`, { method: 'POST', body: { intoId: target.id, shape: { type: 'polygon', points: shape } } });
            await refresh();
            select(target.id);
            pushToast(`「${source.name}」并进了「${target.name}」`, undefined, 'success');
          } catch (error) {
            fail(error);
          }
        })(),
    });
  };

  return {
    splitting,
    plan,
    merging,
    busy,
    mergeTargets: merging ? new Set(candidates(merging).map((one) => one.id)) : undefined,
    startSplit: (room: StorageLocation) => setSplitting(room.id),
    onLine,
    confirmSplit,
    closePlan: () => setPlan(null),
    startMerge,
    pickTarget,
    cancel: () => {
      setSplitting(null);
      setMerging(null);
    },
  };
}
