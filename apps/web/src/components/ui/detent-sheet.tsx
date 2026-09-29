import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animateSpring, project, rubberband } from '../../lib/spring';

/** 全屏档时离屏幕顶部留多少（露一点背后的页面，知道自己在一层 sheet 里）。 */
const TOP_GAP = 12;
/** 打开时停在约 60% 高。 */
const MEDIUM_SHOWN = 0.6;
/** 手指动过这么多才算拖，不然是点按。 */
const DRAG_SLOP = 6;

type Detent = 'medium' | 'full';

/**
 * 手机上的两档 sheet（smart-home-redesign §9.7、apple-design §3~§9）：打开停在约 60%，上滑到全屏，下拉到底关闭。
 * 跟手、随时能抓住反向（弹簧从当前位置和速度出发）；松手按速度投射决定停哪一档；拉过顶有橡皮筋阻尼。
 * 60% 档时整张都能拖（内容不滚）；全屏档时内容正常滚，拖头部往下收。从滑块、输入框、下拉框开始的拖动不接管。
 */
export function DetentSheet({
  title,
  header,
  children,
  onClose,
  modal = true,
  mediumShown = MEDIUM_SHOWN,
}: {
  title: string;
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** false：不压暗、不锁页面，sheet 上方的内容照样能点（家庭地图：抽屉开着还能点别的房间） */
  modal?: boolean;
  /** 半开档露出多高（占屏幕比例），默认 0.6 */
  mediumShown?: number;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(() => window.innerHeight - TOP_GAP);
  const [detent, setDetent] = useState<Detent>('medium');
  const y = useRef(height);
  const stop = useRef<() => void>(() => undefined);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startSheetY: number;
    active: boolean;
    history: { y: number; t: number }[];
  } | null>(null);
  const closing = useRef(false);
  /** 拖动中挂在 window 上的监听；卸载时摘掉 */
  const detach = useRef<() => void>(() => undefined);

  const medium = height * (1 - mediumShown);
  const apply = useCallback(
    (value: number) => {
      y.current = value;
      if (sheet.current) sheet.current.style.transform = `translateY(${value}px)`;
      if (scrim.current) scrim.current.style.opacity = String(Math.max(0, Math.min(1, 1 - value / height)));
    },
    [height],
  );

  const settle = useCallback(
    (target: number, velocity = 0) => {
      stop.current();
      // 停稳了才标 settled（测试和读屏用：动画中的位置不作数）
      if (sheet.current) sheet.current.dataset.sheetSettled = 'false';
      stop.current = animateSpring(y.current, target, velocity, (value) => apply(value), () => {
        if (sheet.current) sheet.current.dataset.sheetSettled = 'true';
        if (target >= height) onClose();
      });
    },
    [apply, height, onClose],
  );

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    settle(height);
  }, [height, settle]);

  // 打开：从屏幕底下弹到 60% 档
  useEffect(() => {
    apply(height);
    settle(height * (1 - mediumShown));
    sheet.current?.focus();
    return () => {
      stop.current();
      detach.current();
    };
    // 只在打开时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight - TOP_GAP);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    if (modal) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      if (modal) document.body.style.overflow = previous;
    };
  }, [close, modal]);

  // 按下时就在 window 上听移动和松开：手指一甩第一步就可能出了 sheet 的边（落到遮罩上），
  // 只挂在 sheet 上会收不到。真正拖起来（过了 6px）才捕获指针，普通点按照常落到按钮上。
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current || closing.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="slider"], input, select, textarea')) return;
    const onHandle = Boolean(target.closest('[data-sheet-handle]'));
    if (!onHandle && detent === 'full') return; // 全屏档：内容自己滚
    stop.current(); // 抓住正在动的 sheet
    const element = event.currentTarget;
    const current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startSheetY: y.current,
      active: false,
      history: [{ y: event.clientY, t: event.timeStamp }],
    };
    drag.current = current;

    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== current.pointerId) return;
      const delta = move.clientY - current.startY;
      if (!current.active) {
        if (Math.abs(delta) < DRAG_SLOP) return;
        current.active = true;
        try {
          element.setPointerCapture(move.pointerId);
        } catch {
          /* 指针已经抬起 */
        }
      }
      current.history = [...current.history.slice(-5), { y: move.clientY, t: move.timeStamp }];
      const raw = current.startSheetY + delta;
      apply(raw < 0 ? -rubberband(-raw, height) : raw);
    };
    const onEnd = (end: globalThis.PointerEvent) => {
      if (end.pointerId !== current.pointerId) return;
      detach.current();
      drag.current = null;
      if (!current.active) return;
      const first = current.history[0];
      const last = current.history[current.history.length - 1];
      const seconds = Math.max(0.016, (last.t - first.t) / 1000);
      const velocity = (last.y - first.y) / seconds;
      const projected = y.current + project(velocity);
      const stops: [Detent | 'closed', number][] = [
        ['full', 0],
        ['medium', medium],
        ['closed', height],
      ];
      const [next, to] = stops.reduce((best, one) => (Math.abs(one[1] - projected) < Math.abs(best[1] - projected) ? one : best));
      if (next === 'closed') {
        closing.current = true;
      } else {
        setDetent(next);
      }
      settle(to, velocity);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    detach.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      detach.current = () => undefined;
    };
  };

  return createPortal(
    <div className={'fixed inset-0 z-50 ' + (modal ? '' : 'pointer-events-none')}>
      {modal ? <div ref={scrim} className="absolute inset-0 bg-black/35" style={{ opacity: 0 }} onMouseDown={close} /> : null}
      <div
        ref={sheet}
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        tabIndex={-1}
        data-sheet-detent={detent}
        className={
          'absolute inset-x-0 bottom-0 flex flex-col rounded-t-[24px] border-t border-border shadow-xl outline-none ' +
          (modal ? 'bg-surface' : 'pointer-events-auto bg-surface/92 backdrop-blur-xl')
        }
        style={{ height, transform: `translateY(${height}px)` }}
        onPointerDown={onPointerDown}
      >
        <div data-sheet-handle className="shrink-0 touch-none px-5 pb-3 pt-2">
          <button
            type="button"
            aria-label={detent === 'full' ? '收回一半' : '拉到全屏'}
            className="mx-auto mb-2 block h-5 w-16"
            onClick={() => {
              const next = detent === 'full' ? 'medium' : 'full';
              setDetent(next);
              settle(next === 'full' ? 0 : medium);
            }}
          >
            <span aria-hidden="true" className="mx-auto block h-[5px] w-9 rounded-full bg-border" />
          </button>
          {header}
        </div>
        <div
          className={`min-h-0 flex-1 px-5 ${detent === 'full' ? 'overflow-y-auto overscroll-contain' : 'touch-none overflow-hidden'}`}
          style={{ paddingBottom: `calc(${detent === 'full' ? 0 : medium}px + 28px + env(safe-area-inset-bottom))` }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
