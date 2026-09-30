import { useCallback, useRef, useState } from 'react';
import type { MapDecoration, MapShape } from '@family/contracts';

// 地图编辑器 v2 §4：本次编辑内的撤销 / 重做，最多 50 步，点「完成」或刷新就清空。
// 每一步存成数据（不是闭包），执行交给编辑器的 apply；「新建」撤掉再重做会得到新 id，用 remap 把后面几步里的旧 id 换过来。
// 拆分、合并、从图上拿掉不进这里（v2 拍板 2：操作前确认）。

/** 装饰类家具整列的前后两版（拖房间时里面的装饰跟着走，和形状记成同一步） */
export interface DecorChange {
  before: MapDecoration[];
  after: MapDecoration[];
}

export type UndoStep =
  | { kind: 'shape'; label: string; changes: { id: string; before: MapShape | null; after: MapShape | null }[]; decor?: DecorChange }
  | { kind: 'rename'; label: string; id: string; before: string; after: string }
  | { kind: 'icon'; label: string; id: string; before: { icon: string | null; name: string }; after: { icon: string | null; name: string } }
  | { kind: 'create'; label: string; id: string; parentId: string | null; name: string; locationKind: 'room' | 'container'; icon?: string | null; shape: MapShape }
  | ({ kind: 'decorations'; label: string } & DecorChange);

export interface UndoApply {
  /** 按方向把这一步做出来；create 撤销时返回 false 表示删不掉（里面记了东西），这一步从栈里拿掉 */
  run: (step: UndoStep, direction: 'undo' | 'redo', resolve: (id: string) => string) => Promise<{ ok: boolean; newId?: string }>;
}

const LIMIT = 50;

export function useUndo({ run }: UndoApply) {
  const undoStack = useRef<UndoStep[]>([]);
  const redoStack = useRef<UndoStep[]>([]);
  const remap = useRef(new Map<string, string>());
  /** 栈本身在 ref 里（异步执行时要读最新的），长度同步到 state 给按钮用 */
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const busy = useRef(false);
  const refresh = () => setDepth({ undo: undoStack.current.length, redo: redoStack.current.length });

  const resolve = useCallback((id: string) => {
    let current = id;
    // 可能被重建过好几次：一路换到最新
    for (let guard = 0; guard < 10 && remap.current.has(current); guard += 1) current = remap.current.get(current)!;
    return current;
  }, []);

  const push = useCallback((step: UndoStep) => {
    undoStack.current = [...undoStack.current, step].slice(-LIMIT);
    redoStack.current = [];
    refresh();
  }, []);

  const move = useCallback(
    async (direction: 'undo' | 'redo') => {
      if (busy.current) return null;
      const from = direction === 'undo' ? undoStack : redoStack;
      const to = direction === 'undo' ? redoStack : undoStack;
      const step = from.current[from.current.length - 1];
      if (!step) return null;
      busy.current = true;
      try {
        const result = await run(step, direction, resolve);
        from.current = from.current.slice(0, -1);
        if (result.ok) {
          if (result.newId && step.kind === 'create') remap.current.set(resolve(step.id), result.newId);
          to.current = [...to.current, step].slice(-LIMIT);
        }
        refresh();
        return step;
      } finally {
        busy.current = false;
      }
    },
    [run, resolve],
  );

  return {
    push,
    undo: () => move('undo'),
    redo: () => move('redo'),
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
    resolve,
  };
}
