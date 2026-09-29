import { useEffect, useRef, useState } from 'react';
import { COMMIT_IDLE_MS, snapToStep } from '../../lib/smart-home-controls';

/**
 * 合并连按的步进（smart-home-redesign §9.6）：− / + 只动预览，停手 0.6 秒才调一次 onCommit，发的是最终的绝对值
 * （不是 ±1），天然幂等。size = big 是空调目标温度那种大号的。pending 时置灰，显示回到外面给的 value。
 */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  pending = false,
  size = 'md',
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
  size?: 'md' | 'big';
  format?: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  // 调节中显示预览；已发出的只在 pending 期间显示，pending 一结束就显示外面的 value（跟 HA 走）
  const [preview, setPreview] = useState<{ value: number; sent: boolean } | null>(null);
  const previewRef = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = disabled || pending;
  const shown = preview && (!preview.sent || pending) ? preview.value : value;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const nudge = (direction: 1 | -1) => {
    if (locked) return;
    const next = snapToStep(shown + direction * step, min, max, step);
    previewRef.current = next;
    setPreview({ value: next, sent: false });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const target = previewRef.current;
      previewRef.current = null;
      if (target !== null && target !== value) {
        setPreview({ value: target, sent: true });
        onCommit(target);
      } else {
        setPreview(null);
      }
    }, COMMIT_IDLE_MS);
  };

  const big = size === 'big';
  const button =
    'grid shrink-0 place-items-center rounded-2xl bg-surface text-ink shadow-sm transition-transform duration-150 ' +
    'active:scale-[.97] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
    (big ? 'size-16 text-3xl' : 'size-11 text-xl');
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending || undefined}
      className={`flex items-center justify-between gap-3 rounded-2xl bg-muted ${big ? 'p-2' : 'p-1'}`}
    >
      <button type="button" className={button} aria-label={`${label}：减`} disabled={locked || shown <= min} onClick={() => nudge(-1)}>
        −
      </button>
      <span
        aria-live="polite"
        className={
          'min-w-0 flex-1 text-center tabular-nums transition-opacity duration-150 ' +
          (big ? 'text-[44px] font-semibold leading-none' : 'text-base font-medium') +
          (pending ? ' opacity-50' : '')
        }
      >
        {format(shown)}
      </span>
      <button type="button" className={button} aria-label={`${label}：加`} disabled={locked || shown >= max} onClick={() => nudge(1)}>
        +
      </button>
    </div>
  );
}
