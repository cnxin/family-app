import { useCallback, useEffect } from 'react';
import type { MapShape, StorageLocation } from '@family/contracts';
import { ApiError, api } from '../../../lib/api';
import { useUpdateLocation } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';
import type { ShapeChange } from '../map-types';
import { useUndo, type UndoStep } from './use-undo';

// 编辑器的撤销 / 重做（地图编辑器 v2 §4）：把「改形状、改名、新画一块」记成一步一步，撤 / 重时交给 saver 和接口。
// 形状照旧走 useShapeSaver（写缓存 + 停手 500 ms 保存，房间先柜子后）；连续拖一次只算一步。
// 新画的柜子 / 房间撤销 = 删掉那个位置（还没记东西时）；重做 = 按原名原形状再建一个（新 id，后面几步自动换过来）。

interface Saver {
  save: (changes: { id: string; shape: MapShape | null }[]) => void;
  saveNow: (changes: { id: string; shape: MapShape | null }[]) => Promise<void>;
}

export function useEditorHistory({ locations, saver }: { locations: StorageLocation[]; saver: Saver }) {
  const update = useUpdateLocation();

  const run = useCallback(
    async (step: UndoStep, direction: 'undo' | 'redo', resolve: (id: string) => string) => {
      if (step.kind === 'shape') {
        saver.save(step.changes.map((change) => ({ id: resolve(change.id), shape: direction === 'undo' ? change.before : change.after })));
        return { ok: true };
      }
      if (step.kind === 'rename') {
        try {
          await update.mutateAsync({ id: resolve(step.id), name: direction === 'undo' ? step.before : step.after });
          return { ok: true };
        } catch (error) {
          pushToast(error instanceof ApiError ? error.message : '没改成，检查一下网络');
          return { ok: false };
        }
      }
      if (step.kind === 'create') {
        if (direction === 'undo') {
          try {
            await api(`/locations/${resolve(step.id)}`, { method: 'DELETE' });
            return { ok: true };
          } catch (error) {
            pushToast(error instanceof ApiError && error.status === 409 ? `「${step.name}」里已经记了东西，撤不掉了` : '没撤掉，检查一下网络');
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
          pushToast(error instanceof ApiError ? error.message : '没重做成，检查一下网络');
          return { ok: false };
        }
      }
      return { ok: false };
    },
    [saver, update],
  );

  const history = useUndo({ run });

  /** 画布拖完、转向、矩形化、对齐：记一步再交给 saver */
  const commitShapes = useCallback(
    (changes: ShapeChange[] | { id: string; shape: MapShape | null }[], label: string) => {
      const before = new Map(locations.map((one) => [one.id, one.mapShape]));
      history.push({
        kind: 'shape',
        label,
        changes: changes.map((change) => ({ id: change.id, before: before.get(change.id) ?? null, after: change.shape })),
      });
      saver.save(changes);
    },
    [locations, history, saver],
  );

  const rename = useCallback(
    (location: StorageLocation, name: string) => {
      update.mutate(
        { id: location.id, name },
        {
          onSuccess: () => history.push({ kind: 'rename', label: '改名', id: location.id, before: location.name, after: name }),
          onError: (error) => pushToast(error.message),
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

  return { history, commitShapes, rename };
}
