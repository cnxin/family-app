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
