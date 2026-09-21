import { PinsProvider } from '../lib/pins';
import { useModules } from '../lib/queries/modules';
import { PinnedNavigation } from './pinned-navigation';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { coreSegments, matchesPath } from '../lib/nav';
import { BottomTabs } from './bottom-tabs';
import { usePrefetch } from './nav-prefetch';
import { applyTheme, readTheme } from '../lib/theme';
import { Button } from './ui';
import { openPalette } from './command-palette';
import { SoftLink, useSoftNavigate } from './soft-link';

function Sidebar() {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="功能导航">
      {coreSegments().map((segment) => {
        const href = segment.path!;
        const current = matchesPath(pathname, href);
        return (
          <SoftLink
            key={segment.key}
            to={href}
            active={current}
            {...prefetch.bind(href)}
            className={
              'mb-0.5 flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ' +
              (current ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft hover:bg-muted hover:text-ink')
            }
          >
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[12px]">{segment.glyph}</span>
            <span className="truncate">{segment.label}</span>
          </SoftLink>
        );
      })}
      <PinnedNavigation />
    </nav>
  );
}

export function Shell() {
  const { session } = useAuth();
  // 常驻订阅即外壳级预取，今天页进入也会为侧栏准备模块状态。
  useModules();
  return <PinsProvider key={session!.member.id} memberId={session!.member.id}><ShellLayout /></PinsProvider>;
}

function ShellLayout() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const soft = useSoftNavigate();
  const prefetch = usePrefetch();
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const manager = session?.member.role === 'owner' || session?.member.role === 'admin';
  const themeButton = (
    <Button
      variant="ghost"
      aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="size-11 shrink-0 p-0 text-[18px]"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </Button>
  );
  const footerLink = (current: boolean) =>
    'flex min-h-11 items-center rounded-lg px-2.5 text-sm transition-colors duration-150 ' +
    (current ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft hover:bg-muted hover:text-ink');

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col border-r border-border bg-surface lg:flex">
        <button type="button" onClick={() => soft('/')} className="flex h-14 shrink-0 items-center px-4 text-left text-[15px] font-semibold">
          小管家
        </button>
        <div className="px-2 pb-1">
          <button type="button" onClick={openPalette} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-bg px-2.5 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted">
            <span className="flex-1 text-left">搜索</span>
            <kbd className="rounded border border-border px-1 font-sans text-[10px]">⌘K</kbd>
          </button>
        </div>
        <Sidebar />
        <nav aria-label="家庭与设置" className="shrink-0 px-2 pb-2">
          <SoftLink to="/home" active={pathname === '/home'} {...prefetch.bind('/home')} className={footerLink(pathname === '/home')}>
            家里（全部功能）
          </SoftLink>
          {manager ? (
            <SoftLink to="/settings" active={pathname === '/settings'} className={footerLink(pathname === '/settings')}>
              家庭设置
            </SoftLink>
          ) : null}
        </nav>
        <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-2">
          <SoftLink to="/me/profile" active={pathname === '/me/profile'} aria-label="个人设置" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-sm hover:bg-muted">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">{session?.member.avatarEmoji ?? '我'}</span>
            <span className="truncate">{session?.member.name}</span>
          </SoftLink>
          {themeButton}
        </div>
      </aside>

      <div className="flex min-h-full flex-col lg:h-dvh lg:pl-[224px]">
        <header className="vt-chrome-top sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 w-full items-center gap-1 px-4">
            <button type="button" onClick={() => soft('/')} className="min-h-11 min-w-0 flex-1 truncate text-left text-[15px] font-semibold">小管家</button>
            <button type="button" onClick={openPalette} aria-label="快速跳转" className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted">🔍</button>
            {themeButton}
          </div>
        </header>
        <main className="flex-1 [view-transition-name:page] lg:h-dvh lg:overflow-y-auto" key={pathname}>
          <Outlet />
        </main>
      </div>
      <BottomTabs manager={manager} />
    </div>
  );
}
