import type { NavSegment } from '../lib/nav';
import { useHomeStatus } from '../lib/home-status';
import { usePrefetch } from './nav-prefetch';
import { SoftLink } from './soft-link';

export function HomeTile({ segment }: { segment: NavSegment }) {
  const status = useHomeStatus(segment.key);
  const prefetch = usePrefetch();
  if (!segment.path) return null;
  return (
    <SoftLink
      to={segment.path}
      {...prefetch.bind(segment.path)}
      aria-label={segment.label}
      className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border bg-surface p-2.5 text-center transition-colors duration-150 hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 lg:p-4"
    >
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-xl font-semibold text-accent">
        {segment.glyph}
      </span>
      <span className="max-w-full text-[13px] font-medium leading-5 text-ink">{segment.label}</span>
      {status && <span data-home-status className="max-w-full truncate text-[11px] leading-4 text-ink-soft" title={status}>{status}</span>}
    </SoftLink>
  );
}
