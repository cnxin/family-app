import { useAuth } from '../lib/auth';
import { shelfSegments } from '../lib/nav';
import { openPalette } from '../components/command-palette';
import { HomeTile } from '../components/home-tile';
import { SoftLink } from '../components/soft-link';
import { Page, Panel } from '../components/ui';

export default function HomePage() {
  const { session } = useAuth();
  const member = session?.member;
  const manager = member?.role === 'owner' || member?.role === 'admin';
  return (
    <Page title="家里" subtitle="家里的功能，都在这里" toolbar={
      <button
        type="button"
        onClick={openPalette}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-ink-soft transition-colors duration-150 hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span>搜索功能</span>
        <span aria-hidden="true" className="text-xs">⌘K</span>
      </button>
    }>
      <Panel title="家里在用的">
        <div className="flex min-h-full flex-col">
          <div data-home-grid className="grid grid-cols-3 gap-2 p-3 lg:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] lg:gap-3 lg:p-4">
            {shelfSegments(member).map((segment) => <HomeTile key={segment.key} segment={segment} />)}
          </div>
          <SoftLink
            to={manager ? '/settings' : '/me/profile'}
            className="mt-auto flex min-h-11 items-center justify-between border-t border-border px-4 py-3 text-sm text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
          >
            <span>{manager ? '家庭设置' : '个人'}</span>
            <span aria-hidden="true">›</span>
          </SoftLink>
        </div>
      </Panel>
    </Page>
  );
}
