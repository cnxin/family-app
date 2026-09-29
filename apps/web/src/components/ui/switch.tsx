/** 开关（role=switch）。点一下就发；pending 时置灰，位置跟着 HA 的状态走，不做乐观切换。 */
export function Switch({
  label,
  checked,
  pending = false,
  disabled = false,
  size = 'md',
  onChange,
}: {
  label: string;
  checked: boolean;
  pending?: boolean;
  disabled?: boolean;
  size?: 'md' | 'big';
  onChange: (next: boolean) => void;
}) {
  const big = size === 'big';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={() => onChange(!checked)}
      className={
        'relative shrink-0 rounded-full transition-[background-color,opacity] duration-200 ease-out ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed ' +
        (big ? 'h-[38px] w-[62px] ' : 'h-[30px] w-[50px] ') +
        (checked ? 'bg-accent ' : 'bg-border ') +
        (pending ? 'opacity-60' : disabled ? 'opacity-40' : '')
      }
    >
      <span
        aria-hidden="true"
        className={
          'absolute top-[3px] rounded-full bg-white shadow transition-[left] duration-200 ease-out ' +
          (big ? 'size-8 ' : 'size-6 ') +
          (checked ? (big ? 'left-[27px]' : 'left-[23px]') : 'left-[3px]')
        }
      />
    </button>
  );
}
