import { useEffect } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/* 控件的四个状态（悬停/按下/聚焦/禁用）在这一层一次写清楚，页面不再各写各的。
   形状和 shadcn 对齐，等接入真正的 shadcn 组件时可以平替。 */

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium ' +
  'transition-[background-color,color,box-shadow,transform] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 active:scale-[.985]';

const variants = {
  primary: 'bg-accent text-white hover:brightness-110 active:brightness-95',
  ghost: 'text-ink-soft hover:bg-muted hover:text-ink',
  outline: 'border border-border bg-surface text-ink hover:bg-muted',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${base} ${variants[variant]} h-10 px-4 ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink ' +
        'placeholder:text-ink-soft/70 transition-[border-color,box-shadow] duration-150 ' +
        'hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
        `disabled:opacity-50 ${className}`
      }
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-border bg-surface ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-ink-soft">{children}</h2>
      {right}
    </div>
  );
}

export function Checkbox({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={
        'grid size-[22px] shrink-0 place-items-center rounded-full border transition-[background-color,border-color,transform] ' +
        'duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
        'disabled:opacity-40 ' +
        (checked ? 'border-accent bg-accent' : 'border-border hover:border-ink-soft/50')
      }
    >
      <svg viewBox="0 0 24 24" className={`size-3 ${checked ? 'opacity-100' : 'opacity-0'}`}>
        <path
          d="M4 12.5l5.2 5.2L20 6.8"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export const selectClass =
  'h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink ' +
  'transition-colors duration-150 hover:border-ink-soft/40 focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

/** 分段控件：同一页里切视图用，不占一个导航位。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={
              'rounded-[7px] px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
              (active ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-soft hover:text-ink')
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 模态框：手机上从底部铺满，桌面上居中。Esc 关闭，点遮罩关闭，
 * 打开时锁住 body 滚动——不锁的话背后的长列表会跟着手指一起动。
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  maxWidth = 480,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth }}
        className="flex max-h-[88vh] w-full flex-col rounded-t-card border border-border bg-surface shadow-xl sm:rounded-card"
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="-mr-1 grid size-8 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
