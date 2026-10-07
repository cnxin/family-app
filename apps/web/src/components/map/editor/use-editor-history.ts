import { useCallback, useEffect } from 'react';
import type { MapDecoration, MapShape, StorageLocation } from '@family/contracts';
import { ApiError, api } from '../../../lib/api';
import { useUpdateLocation } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import type { ShapeChange } from '../map-types';
import { useUndo, type UndoStep } from './use-undo';

// 编辑器的撤销 / 重做（地图编辑器 v2 §4）：把「改形状、改名、新画一块」记成一步一步，撤 / 重时交给 saver 和接口。
// 形状照旧走 useShapeSaver（写缓存 + 停手 500 ms 保存，房间先柜子后）；连续拖一次只算一步。
// 新画的柜子 / 房间撤销 = 删掉那个位置（还没记东西时）；重做 = 按原名原形状再建一个（新 id，后面几步自动换过来）。
// 装饰类家具整列写回上一版（use-decorations 排队保存）；拖房间时里面的装饰跟着走，和形状算同一步。

interface Saver {
  save: (changes: { id: string; shape: MapShape | null }[]) => void;
  saveNow: (changes: { id: string; shape: MapShape | null }[]) => Promise<void>;
}

interface DecorStore {
  items: MapDecoration[];
  save: (items: MapDecoration[]) => Promise<boolean>;
}

/** 画布给的形状改动里挑出装饰的，拼成新的一整列；没有装饰改动返回 null */
function decorAfter(items: MapDecoration[], changes: { id: string; shape: MapShape | null }[]): MapDecoration[] | null {
  const byId = new Map(changes.map((change) => [change.id, change.shape]));
  if (!items.some((one) => byId.has(one.id))) return null;
  return items.map((one) => {
    const shape = byId.get(one.id);
    if (!shape || shape.type !== 'rect') return one;
    const { x, y, w, h, rotation } = shape;
    const next: MapDecoration = { id: one.id, kind: one.kind, roomId: one.roomId, x, y, w, h };
    return rotation ? { ...next, rotation } : next;
  });
}

export function useEditorHistory({ locations, saver, decor }: { locations: StorageLocation[]; saver: Saver; decor: DecorStore }) {
  const update = useUpdateLocation();

  const run = useCallback(
    async (step: UndoStep, direction: 'undo' | 'redo', resolve: (id: string) => string) => {
      if (step.kind === 'shape') {
        if (step.changes.length) saver.save(step.changes.map((change) => ({ id: resolve(change.id), shape: direction === 'undo' ? change.before : change.after })));
        if (step.decor) void decor.save(direction === 'undo' ? step.decor.before : step.decor.after);
        return { ok: true };
      }
      if (step.kind === 'decorations') {
        return { ok: await decor.save(direction === 'undo' ? step.before : step.after) };
      }
      if (step.kind === 'rename' || step.kind === 'icon') {
        const value = direction === 'undo' ? step.before : step.after;
        try {
          await update.mutateAsync(typeof value === 'string' ? { id: resolve(step.id), name: value } : { id: resolve(step.id), name: value.name, icon: value.icon as never });
          return { ok: true };
        } catch (error) {
          pushToast(error instanceof ApiError ? error.message : '没改成，检查一下网络', undefined, 'error');
          return { ok: false };
        }
      }
      if (step.kind === 'create') {
        if (direction === 'undo') {
          try {
            await api(`/locations/${resolve(step.id)}`, { method: 'DELETE' });
            return { ok: true };
          } catch (error) {
            pushToast(error instanceof ApiError && error.status === 409 ? `「${step.name}」里已经记了东西，撤不掉了` : '没撤掉，检查一下网络', undefined, 'error');
            return { ok: false };
          }
        }
        try {
          const created = await api<StorageLocation>('/locations', {
            method: 'POST',
            body: { parentId: step.parentId ? resolve(step.parentId) : null, name: step.name, kind: step.locationKind === 'room' ? undefined : 'container', ...(step.icon ? { icon: step.icon } : {}) },
          });
          await saver.saveNow([{ id: created.id, shape: step.shape }]);
          return { ok: true, newId: created.id };
        } catch (error) {
          pushToast(error instanceof ApiError ? error.message : '没重做成，检查一下网络', undefined, 'error');
          return { ok: false };
        }
      }
      return { ok: false };
    },
    [saver, update, decor],
  );

  const history = useUndo({ run });

  /** 画布拖完、转向、矩形化、对齐：记一步再交给 saver（装饰的那部分交给 decor） */
  const commitShapes = useCallback(
    (changes: ShapeChange[] | { id: string; shape: MapShape | null }[], label: string) => {
      const before = new Map(locations.map((one) => [one.id, one.mapShape]));
      const own = changes.filter((change) => before.has(change.id));
      const nextDecor = decorAfter(decor.items, changes);
      history.push({
        kind: 'shape',
        label,
        changes: own.map((change) => ({ id: change.id, before: before.get(change.id) ?? null, after: change.shape })),
        ...(nextDecor ? { decor: { before: decor.items, after: nextDecor } } : {}),
      });
      if (own.length) saver.save(own);
      if (nextDecor) void decor.save(nextDecor);
    },
    [locations, history, saver, decor],
  );

  /** 装饰整列换成 after（放下、删掉、换类型、挪房间） */
  const commitDecor = useCallback(
    (after: MapDecoration[], label: string) => {
      history.push({ kind: 'decorations', label, before: decor.items, after });
      void decor.save(after);
    },
    [history, decor],
  );

  /** 换成别的收纳家具（改 icon；名字还是自动起的就跟着换，比如「衣柜 2」→「书柜」） */
  const setIcon = useCallback(
    (location: StorageLocation, icon: string | null, name: string) => {
      update.mutate(
        { id: location.id, icon: icon as never, name },
        {
          onSuccess: () =>
            history.push({ kind: 'icon', label: '换家具', id: location.id, before: { icon: location.icon, name: location.name }, after: { icon, name } }),
          onError: (error) => pushToast(error.message, undefined, 'error'),
        },
      );
    },
    [update, history],
  );

  const rename = useCallback(
    (location: StorageLocation, name: string) => {
      update.mutate(
        { id: location.id, name },
        {
          onSuccess: () => history.push({ kind: 'rename', label: '改名', id: location.id, before: location.name, after: name }),
          onError: (error) => pushToast(error.message, undefined, 'error'),
        },
      );
    },
    [update, history],
  );

  // ⌘Z / ⇧⌘Z（Windows Ctrl）；输入框里不接管
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      void (event.shiftKey ? history.redo() : history.undo());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [history]);

  return { history, commitShapes, commitDecor, rename, setIcon };
}
