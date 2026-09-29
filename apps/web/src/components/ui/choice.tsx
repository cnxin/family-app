import { selectClass } from './index';

export interface ChoiceOption {
  value: string;
  label: string;
}

/**
 * 点一下就发的单选：选项少时是分段（radiogroup），多时是下拉。current = HA 此刻的值；pendingValue = 刚发出去、
 * 还没回推的那个（在它上面转圈）。整组在 pending 或 disabled 时不能再点（smart-home-redesign §9.6）。
 */
export function ChoiceGroup({
  label,
  options,
  current,
  pendingValue,
  pending = false,
  disabled = false,
  layout = 'segmented',
  onChoose,
}: {
  label: string;
  options: ChoiceOption[];
  current: string | null;
  pendingValue?: unknown;
  pending?: boolean;
  disabled?: boolean;
  layout?: 'segmented' | 'dropdown';
  onChoose: (value: string) => void;
}) {
  const locked = disabled || pending;
  if (layout === 'dropdown') {
    return (
      <select
        aria-label={label}
        aria-busy={pending || undefined}
        className={`${selectClass} min-h-11 min-w-0 max-w-full`}
        disabled={locked}
        value={(pending && typeof pendingValue === 'string' ? pendingValue : current) ?? ''}
        onChange={(event) => onChoose(event.target.value)}
      >
        {current === null ? <option value="">—</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={pending || undefined}
      className="grid gap-[3px] rounded-xl bg-muted p-[3px]"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const checked = option.value === current;
        const sending = pending && option.value === pendingValue;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={locked}
            className={
              'relative min-h-11 min-w-0 truncate rounded-[10px] px-1.5 text-sm transition-[background-color,color,transform] duration-150 ' +
              'active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
              'disabled:cursor-not-allowed ' +
              (checked || sending ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink disabled:text-ink-soft')
            }
            onClick={() => {
              if (!checked) onChoose(option.value);
            }}
          >
            {option.label}
            {sending ? (
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-1/2 size-2.5 -translate-y-1/2 animate-spin rounded-full border-2 border-border border-t-accent"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
