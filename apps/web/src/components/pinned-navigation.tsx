import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { matchesPath, shelfSegments } from '../lib/nav';
import { usePins } from '../lib/pins';
import { useModules } from '../lib/queries/modules';
import { usePrefetch } from './nav-prefetch';
import { SoftLink } from './soft-link';

export function PinnedNavigation() {
  const { session } = useAuth();
  const { pins } = usePins();
  const modules = useModules();
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const segments = shelfSegments(session?.member);
  const visible = pins.flatMap((key) => {
    const segment = segments.find((one) => one.key === key);
    return segment && modules.visible(key) ? [segment] : [];
  });
  if (modules.initialLoading || !visible.length) return null;
  return (
    <section aria-label="我钉住的" className="mt-4 border-t border-border pt-3">
      <h2 className="px-2.5 pb-2 text-xs text-ink-soft">我钉住的</h2>
      {visible.map((segment) => (
        <SoftLink key={segment.key} to={segment.path!} active={matchesPath(pathname, segment.path!)} {...prefetch.bind(segment.path!)}
          className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft hover:bg-muted hover:text-ink">
          <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-muted text-xs">{segment.glyph}</span>
          {segment.label}
        </SoftLink>
      ))}
    </section>
  );
}
