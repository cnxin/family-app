import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { COMMIT_IDLE_MS, snapToStep } from '../../lib/smart-home-controls';

/**
 * 松手才发的滑块（smart-home-redesign §9.6）：拖动时只动预览（气泡里写「松手就发」），松手调一次 onCommit；
 * 方向键 / PageUp / Home / End 调预览，停手 0.6 秒或按回车才发。拖动用指针捕获、只认第一根手指
 * （emil-design-eng：换手指时不跳）。pending 时置灰，显示永远回到外面给的 value（跟 HA 走）。
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  pending = false,
  format = (next) => String(next),
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  pending?: boolean;
  format?: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  // 预览带阶段：拖动中 / 键盘调节中都显示预览；已发出的只在 pending 期间显示，pending 一结束就显示外面的 value
  const [preview, setPreview] = useState<{ value: number; phase: 'dragging' | 'keying' | 'sent' } | null>(null);
  const previewRef = useRef<number | null>(null);
  const pointer = useRef<number | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const locked = disabled || pending;
  const active = preview && (preview.phase !== 'sent' || pending) ? preview : null;
  const shown = active?.value ?? value;
  const fraction = max > min ? (shown - min) / (max - min) : 0;

  const show = (next: number, phase: 'dragging' | 'keying') => {
    previewRef.current = next;
    setPreview({ value: next, phase });
  };
  const commit = () => {
    const next = previewRef.current;
    previewRef.current = null;
    if (next !== null && next !== value) {
      setPreview({ value: next, phase: 'sent' });
      onCommit(next);
    } else {
      setPreview(null);
    }
  };

  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current);
    },
    [],
  );

  const fromPointer = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return shown;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return snapToStep(min + ratio * (max - min), min, max, step);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked || pointer.current !== null) return;
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    show(fromPointer(event.clientX), 'dragging');
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointer.current) return;
    show(fromPointer(event.clientX), 'dragging');
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointer.current) return;
    pointer.current = null;
    commit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const big = Math.max(step, (max - min) / 10);
    const moves: Record<string, number> = {
      ArrowRight: shown + step,
      ArrowUp: shown + step,
      ArrowLeft: shown - step,
      ArrowDown: shown - step,
      PageUp: shown + big,
      PageDown: shown - big,
      Home: min,
      End: max,
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      if (keyTimer.current) clearTimeout(keyTimer.current);
      keyTimer.current = null;
      commit();
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    show(snapToStep(moves[event.key], min, max, step), 'keying');
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => {
      keyTimer.current = null;
      commit();
    }, COMMIT_IDLE_MS);
  };

  const dragging = preview?.phase === 'dragging' || preview?.phase === 'keying';
  return (
    <div
      role="slider"
      tabIndex={locked ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={format(shown)}
      aria-disabled={locked || undefined}
      aria-busy={pending || undefined}
      data-slider-pending={pending || undefined}
      className={
        'relative flex h-11 touch-none select-none items-center rounded-full outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-accent/60 ' +
        (locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div ref={track} className="relative h-2.5 w-full rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span
        aria-hidden="true"
        className={
          'absolute size-7 -translate-x-1/2 rounded-full border border-border bg-surface shadow ' +
          'transition-transform duration-150 ease-out ' +
          (dragging ? 'scale-110' : '')
        }
        style={{ left: `${fraction * 100}%` }}
      />
      {dragging ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-[12px] text-surface"
          style={{ left: `${fraction * 100}%` }}
        >
          {format(shown)} · 松手就发
        </span>
      ) : null}
    </div>
  );
}
