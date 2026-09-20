import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PINNED, SCENES, inScene, landingPath, sceneOf, segmentOf, visibleSegments } from '../lib/nav';
import { BottomTabs } from './bottom-tabs';
import { segmentHref, usePrefetch } from './nav-prefetch';
import { applyTheme, readTheme } from '../lib/theme';
import { Button } from './ui';
import { openPalette } from './command-palette';
import { SoftLink, useSoftNavigate } from './soft-link';
import { AccountMenu } from './account-menu';

// ---- 桌面：左侧竖向导航 -------------------------------------------------------

function Sidebar({ manager }: { manager: boolean }) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const here = inScene(pathname);
  const active = sceneOf(pathname);
  const [openKey, setOpenKey] = useState(active.key);
  const [seenKey, setSeenKey] = useState(active.key);

  // 跟着路由走：换场景时自动展开新场景，手动展开的保留到下次换页
  // （渲染期对比上一次的场景来调整 state，是 React 文档推荐的写法，不用 effect）
  if (seenKey !== active.key) {
    setSeenKey(active.key);
    setOpenKey(active.key);
  }

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="功能导航">
      {SCENES.map((scene) => {
        const segments = visibleSegments(scene, manager);
        const isActive = here && scene.key === active.key;
        const expanded = openKey === scene.key && segments.length > 0;
        const landing = landingPath(scene);

        return (
          <div key={scene.key} className="mb-0.5">
            <button
              type="button"
              {...prefetch.bind(landing)}
              onClick={() => {
                setOpenKey(scene.key);
                if (!isActive || !segments.length) soft(landing);
              }}
              aria-expanded={segments.length ? expanded : undefined}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 ' +
                (isActive ? 'font-medium text-ink' : 'text-ink-soft hover:bg-muted')
              }
            >
              <span className="text-[15px] leading-none">{scene.icon}</span>
              <span className="flex-1 truncate">{scene.label}</span>
              {segments.length ? (
                <span
                  className={
                    'text-[10px] text-ink-soft transition-transform duration-200 ' +
                    (expanded ? 'rotate-90' : '')
                  }
                >
                  ▶
                </span>
              ) : null}
            </button>

            {expanded ? (
              <div className="mb-1 ml-[18px] border-l border-border pl-2">
                {segments.map((segment) => {
                  const href = segmentHref(scene, segment);
                  const current = href === pathname;
                  const ready = Boolean(segment.ready && segment.path);
                  return (
                    <SoftLink
                      key={segment.key}
                      to={href}
                      active={current}
                      {...(ready ? prefetch.bind(href) : {})}
                      className={
                        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 ' +
                        (current
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-ink-soft hover:bg-muted hover:text-ink')
                      }
                    >
                      <span className="truncate">{segment.label}</span>
                      {/* 还没搬到新客户端的，标一个点 */}
                      {ready ? null : <span className="text-warm">·</span>}
                    </SoftLink>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

// ---- 外壳 ---------------------------------------------------------------------

export function Shell() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const soft = useSoftNavigate();
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);

  const manager = session?.member.role !== 'member';
  const scene = sceneOf(pathname);
  const segment = segmentOf(scene, pathname);

  return (
    <div className="min-h-full">
      {/* 桌面：左侧固定竖栏，像后台控制台 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col border-r border-border bg-surface lg:flex">
        <button
          type="button"
          onClick={() => soft('/')}
          className="flex h-14 shrink-0 items-center px-4 text-left text-[15px] font-semibold"
        >
          小管家
        </button>
        <div className="px-2 pb-1">
          <button
            type="button"
            onClick={openPalette}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted"
          >
            <span className="flex-1 text-left">搜索</span>
            <kbd className="rounded border border-border px-1 font-sans text-[10px]">⌘K</kbd>
          </button>
          {/* 问问小管家和个人设置不占场景位，钉在这儿——天天用的工具不该藏进二级菜单 */}
          <div className="mt-1 flex flex-col">
            {PINNED.map((entry) => (
              <SoftLink
                key={entry.key}
                to={entry.path}
                active={pathname.startsWith(entry.path)}
                className={
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ' +
                  (pathname.startsWith(entry.path)
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-soft hover:bg-muted hover:text-ink')
                }
              >
                <span className="text-[15px] leading-none">{entry.icon}</span>
                <span className="flex-1 truncate">{entry.label}</span>
              </SoftLink>
            ))}
          </div>
        </div>
        <Sidebar manager={manager} />
        <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
            {session?.member.name}
          </span>
          <Button
            variant="ghost"
            aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-8 px-2 text-[15px]"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </Button>
          <Button variant="ghost" onClick={signOut} className="h-8 px-2 text-[12px]">
            退出
          </Button>
        </div>
      </aside>

      <div className="flex min-h-full flex-col lg:h-dvh lg:pl-[224px]">
        {/* 手机：顶栏只留当前位置和两个开关，功能切换全部交给底部标签 */}
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 w-full items-center gap-1 px-4">
            <button
              type="button"
              onClick={() => soft('/')}
              className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold"
            >
              小管家
            </button>
            <SoftLink
              to={PINNED[0].path}
              aria-label={PINNED[0].label}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-[17px] transition-colors duration-150 hover:bg-muted"
            >
              {PINNED[0].icon}
            </SoftLink>
            <button
              type="button"
              onClick={openPalette}
              aria-label="快速跳转"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
            >
              🔍
            </button>
            <AccountMenu
              name={session?.member.name ?? '我'}
              dark={theme === 'dark'}
              onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              onSignOut={signOut}
            />
          </div>
        </header>

        {/* view-transition-name 只给主体，导航留在原地不参与淡入 */}
        <main className="flex-1 [view-transition-name:page] lg:h-dvh lg:overflow-y-auto" key={segment?.key ?? scene.key}>
          <Outlet />
        </main>
      </div>

      <BottomTabs manager={manager} />
    </div>
  );
}
