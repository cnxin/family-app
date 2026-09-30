import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenRect } from '../map-canvas';

// 选中对象后紧贴它的小工具条（地图编辑器 v2 §1.3，像 Figma）：默认在对象上方，放不下就放下方，
// 对象比屏幕还高就贴在可见部分顶上；左右夹在屏幕内。「更多」弹层优先放在对象外侧（右 / 左），都放不下才叠在工具条下。
// 拖、捏、平移时先藏起来，松手在新位置淡入。工具条和弹层都不压对象本身。

export interface ToolbarAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface MoreAction extends ToolbarAction {
  hint?: string;
}

const GAP = 10;
const EDGE = 8;

export function FloatingToolbar({
  anchor,
  size,
  moving,
  topSafe,
  bottomSafe,
  actions,
  more,
  rename,
}: {
  /** 对象在画布里的屏幕外接框 */
  anchor: ScreenRect;
  size: { w: number; h: number };
  moving: boolean;
  /** 上下留给固定工具栏 / 按钮的高度 */
  topSafe: number;
  bottomSafe: number;
  actions: ToolbarAction[];
  more?: MoreAction[];
  /** 原地改名：给了就把工具条换成输入框 */
  rename?: { value: string; onSubmit: (name: string) => void; onCancel: () => void } | null;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [barSize, setBarSize] = useState<{ w: number; h: number } | null>(null);
  const [popSize, setPopSize] = useState<{ w: number; h: number } | null>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => setBarSize({ w: element.offsetWidth, h: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rename]);
  useLayoutEffect(() => {
    if (open && pop.current) setPopSize({ w: pop.current.offsetWidth, h: pop.current.offsetHeight });
  }, [open]);

  const w = barSize?.w ?? 0;
  const h = barSize?.h ?? 0;
  const cx = (anchor.left + anchor.right) / 2;
  const left = Math.min(size.w - w - EDGE, Math.max(EDGE, cx - w / 2));
  const above = anchor.top - GAP - h;
  const below = anchor.bottom + GAP;
  const top =
    above >= topSafe ? above : below + h <= size.h - bottomSafe ? below : Math.min(size.h - bottomSafe - h, Math.max(topSafe, anchor.top + GAP));

  let popLeft = 0;
  let popTop = 0;
  if (popSize) {
    const pw = popSize.w;
    const ph = popSize.h;
    popTop = Math.min(size.h - bottomSafe - ph, Math.max(topSafe, top));
    if (anchor.right + 12 + pw <= size.w - EDGE) popLeft = anchor.right + 12;
    else if (anchor.left - 12 - pw >= EDGE) popLeft = anchor.left - 12 - pw;
    else {
      popLeft = Math.min(size.w - pw - EDGE, Math.max(EDGE, left));
      popTop = top + h + 6;
    }
  }

  const hidden = moving || !barSize;
  const button = 'flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-[13px] transition-colors duration-150 hover:bg-muted disabled:opacity-40';

  let content: ReactNode;
  if (rename) {
    content = (
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('name');
          rename.onSubmit(typeof value === 'string' ? value.trim() : '');
        }}
      >
        <input
          name="name"
          autoFocus
          aria-label="新名字"
          defaultValue={rename.value}
          maxLength={40}
          onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), rename.onCancel())}
          className="h-9 w-[180px] rounded-lg border border-border bg-surface px-2.5 text-[14px] outline-none focus:border-accent"
        />
        <button type="submit" className={button + ' font-medium text-accent'}>好</button>
        <button type="button" className={button} onClick={rename.onCancel}>取消</button>
      </form>
    );
  } else {
    content = (
      <>
        {actions.map((action) => (
          <button key={action.key} type="button" disabled={action.disabled} onClick={action.onClick}
            className={button + (action.danger ? ' text-danger' : '')}>
            {action.label}
          </button>
        ))}
        {more?.length ? (
          <button type="button" aria-expanded={open} aria-label="更多" onClick={() => setOpen(!open)}
            className={button + (open ? ' bg-accent text-white hover:bg-accent' : '')}>
            ··· 更多
          </button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        ref={bar}
        role="toolbar"
        aria-label="选中对象的操作"
        data-map-floating
        style={{ left, top, visibility: hidden ? 'hidden' : 'visible' }}
        className="absolute z-10 flex items-center gap-0.5 rounded-xl border border-border bg-surface/92 p-1 shadow-lg backdrop-blur-xl motion-safe:animate-[float-in_150ms_cubic-bezier(0,0,0.2,1)]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </div>
      {open && more?.length && !rename ? (
        <div
          ref={pop}
          role="menu"
          aria-label="更多操作"
          style={{ left: popLeft, top: popTop, visibility: hidden || !popSize ? 'hidden' : 'visible' }}
          className="absolute z-10 w-[220px] rounded-xl border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur-xl motion-safe:animate-[float-in_150ms_cubic-bezier(0,0,0.2,1)]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {more.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={
                'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-150 hover:bg-muted disabled:opacity-40 ' +
                (item.danger ? 'text-danger' : '')
              }
            >
              <span>{item.label}</span>
              {item.hint ? <span className="text-[11.5px] text-ink-soft">{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
