import { useState } from 'react';
import type { MapDecoration, MapRect, MapShape, StorageLocation } from '@family/contracts';
import { pointInShape, shapeBounds, type MapPoint } from '@family/shared';
import { newId } from '../../../lib/ids';
import { useCreateLocation, useUpdateLocation } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import { furnitureSpec, nextFurnitureName, placementRect, type FurnitureSpec } from '../furniture-catalog';
import type { FurniturePanelMode } from './furniture-panel';
import type { UndoStep } from './use-undo';

// 家具库的动作（地图编辑器 v2 §3.2）：放下（收纳 = 新建带 icon 的柜子，能撤销；装饰 = 整列加一项）、
// 换成别的家具、挪到别的房间（先点「挪到…」，再在图上点目标房间）。放下、换、挪都轻振一下。

interface Deps {
  locations: StorageLocation[];
  decorations: MapDecoration[];
  selectedId: string | null;
  /** 屏幕中心在地图上的点（没选房间时按它找房间） */
  centre: () => MapPoint | null;
  push: (step: UndoStep) => void;
  commitDecor: (after: MapDecoration[], label: string) => void;
  setIcon: (location: StorageLocation, icon: string | null, name: string) => void;
  saveNow: (changes: { id: string; shape: MapShape | null }[]) => Promise<void>;
  select: (id: string | null) => void;
  /** 手机上放下 / 挪完对准它（新建的位置还没进列表，select 自己找不到形状） */
  focus: (shape: MapRect) => void;
}

const buzz = () => navigator.vibrate?.(10);

export function useFurniture({ locations, decorations, selectedId, centre, push, commitDecor, setIcon, saveNow, select, focus }: Deps) {
  const create = useCreateLocation();
  const update = useUpdateLocation();
  const [panel, setPanel] = useState<FurniturePanelMode | null>(null);
  /** 「挪到别的房间…」：等着点目标房间的那件家具 */
  const [relocating, setRelocating] = useState<string | null>(null);

  const byId = new Map(locations.map((one) => [one.id, one]));
  const decorById = new Map(decorations.map((one) => [one.id, one]));
  const shaped = (id: string | null | undefined) => {
    const room = id ? byId.get(id) : null;
    return room?.kind === 'room' && room.mapShape && !room.archivedAt ? room : null;
  };

  /** 放到哪间：选中的房间 → 选中对象所在的房间 → 屏幕中心所在的房间 */
  const targetRoom = (): StorageLocation | null => {
    if (selectedId) {
      const room = shaped(selectedId) ?? shaped(byId.get(selectedId)?.parentId) ?? shaped(decorById.get(selectedId)?.roomId);
      if (room) return room;
    }
    const point = centre();
    if (!point) return null;
    return [...locations].reverse().find((one) => shaped(one.id) && pointInShape(point, one.mapShape!)) ?? null;
  };
  const room = targetRoom();

  const takenIn = (roomId: string) => locations.filter((one) => one.parentId === roomId).map((one) => one.name);
  /** 房间里已经摆着的（柜子 + 装饰）：新放的尽量不压它们 */
  const occupied = (roomId: string, except?: string) => [
    ...locations.filter((one) => one.parentId === roomId && one.mapShape && !one.archivedAt && one.id !== except).map((one) => shapeBounds(one.mapShape!)),
    ...decorations.filter((one) => one.roomId === roomId && one.id !== except).map((one) => ({ minX: one.x, minY: one.y, maxX: one.x + one.w, maxY: one.y + one.h })),
  ];

  const place = async (spec: FurnitureSpec) => {
    const target = targetRoom();
    if (!target) {
      pushToast('先在图上点一个房间');
      return false;
    }
    const rect = placementRect(spec, target.mapShape!, occupied(target.id));
    if (!rect) {
      pushToast(`「${target.name}」太小，放不下${spec.label}`);
      return false;
    }
    if (spec.group === 'decor') {
      const item: MapDecoration = { id: newId(), kind: spec.key as MapDecoration['kind'], roomId: target.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      commitDecor([...decorations, item], `放${spec.label}`);
      select(item.id);
      focus(rect);
      buzz();
      return true;
    }
    const name = nextFurnitureName(spec.label, takenIn(target.id));
    try {
      const location = await create.mutateAsync({ parentId: target.id, name, kind: 'container', icon: spec.key as never });
      push({ kind: 'create', label: `放${spec.label}`, id: location.id, parentId: target.id, name, locationKind: 'container', icon: spec.key, shape: rect });
      await saveNow([{ id: location.id, shape: rect }]);
      select(location.id);
      focus(rect);
      buzz();
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '没放上，检查一下网络', undefined, 'error');
      return false;
    }
  };

  /** 换成别的家具：收纳换收纳（名字还是自动起的就跟着换），装饰换装饰 */
  const replace = (id: string, spec: FurnitureSpec) => {
    const decor = decorById.get(id);
    if (decor) {
      commitDecor(decorations.map((one) => (one.id === id ? { ...one, kind: spec.key as MapDecoration['kind'] } : one)), '换家具');
      buzz();
      return;
    }
    const location = byId.get(id);
    if (!location) return;
    const old = furnitureSpec(location.icon);
    const auto = old && new RegExp(`^${old.label}( \\d+)?$`).test(location.name);
    const others = locations.filter((one) => one.parentId === location.parentId && one.id !== id).map((one) => one.name);
    setIcon(location, spec.key, auto ? nextFurnitureName(spec.label, others) : location.name);
    buzz();
  };

  /** 挪到 roomId：收纳 = 改上级 + 在新房间里摆好（不进撤销栈）；装饰 = 整列改一项（能撤销） */
  const relocate = async (roomId: string) => {
    const id = relocating;
    setRelocating(null);
    const target = shaped(roomId);
    if (!id || !target) return;
    const decor = decorById.get(id);
    const current = decor ? { w: decor.w, h: decor.h } : byId.get(id)?.mapShape;
    if (!current || !('w' in current)) return;
    if ((decor?.roomId ?? byId.get(id)?.parentId) === roomId) {
      pushToast('已经在这间了');
      return;
    }
    const rect = placementRect({ w: current.w, h: current.h }, target.mapShape!, occupied(target.id, id));
    if (!rect) {
      pushToast(`「${target.name}」放不下`);
      return;
    }
    const turned: MapRect = 'rotation' in current && current.rotation ? { ...rect, rotation: current.rotation } : rect;
    if (decor) {
      commitDecor(decorations.map((one) => (one.id === id ? { ...one, roomId, x: rect.x, y: rect.y, w: rect.w, h: rect.h } : one)), '挪房间');
    } else {
      try {
        await update.mutateAsync({ id, parentId: roomId });
        await saveNow([{ id, shape: turned }]);
      } catch (error) {
        pushToast(error instanceof Error ? error.message : '没挪成，检查一下网络', undefined, 'error');
        return;
      }
    }
    pushToast(`挪到了「${target.name}」`, undefined, 'success');
    select(id);
    focus(rect);
    buzz();
  };

  return { panel, setPanel, room, place, replace, relocating, setRelocating, relocate };
}
