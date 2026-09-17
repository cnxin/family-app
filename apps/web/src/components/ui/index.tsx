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

/**
 * 页面骨架。桌面上内容要把框填满：标题行固定在上面，下面这一块 flex-1，
 * 里面的面板自己撑高、自己滚。之前每页都是「一列内容顶在上面 + 下面一大片背景色」，
 * 数据一少就像页面没做完——空不空是数据的事，但空白该落在面板里，不该落在页面上。
 */
export function Page({
  title,
  subtitle,
  actions,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1160px] flex-col px-4 pb-24 pt-6 lg:mx-0 lg:px-8 lg:pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {toolbar ? <div className="mt-4 shrink-0">{toolbar}</div> : null}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
        {children}
      </div>
    </div>
  );
}

/** 撑满剩余高度、内部滚动的面板——控制台里的一块，不是文档里的一段。 */
export function Panel({
  children,
  className = '',
  title,
  right,
  grow = true,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  right?: ReactNode;
  /** false 表示按内容高度摆着，不去抢剩余空间（比如月历那块） */
  grow?: boolean;
}) {
  return (
    <section
      className={
        'flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-surface ' +
        (grow ? 'flex-1 ' : 'flex-none ') +
        className
      }
    >
      {title ? (
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border px-3.5 py-2.5">
          <h2 className="truncate text-[13px] font-semibold text-ink-soft">{title}</h2>
          {right}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** 空态居中摆在面板里，看着像「这里现在没有东西」，而不是「这块没做」。 */
export function EmptyState({
  emoji,
  title,
  hint,
}: {
  emoji: string;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="text-3xl opacity-80">{emoji}</span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="text-[13px] text-ink-soft">{hint}</p> : null}
    </div>
  );
}
