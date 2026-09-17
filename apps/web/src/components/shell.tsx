import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { SCENES, landingPath, legacyUrl, sceneOf, segmentOf, visibleSegments } from '../lib/nav';
import type { NavScene, NavSegment } from '../lib/nav';
import { prefetchRoute } from '../lib/prefetch';
import { applyTheme, readTheme } from '../lib/theme';
import { Button } from './ui';
import { openPalette } from './command-palette';
import { SoftLink, useSoftNavigate } from './soft-link';

/** 指针一碰就预取；等手指抬起来路由切过去，数据多半已经在缓存里了。 */
function usePrefetch() {
  const client = useQueryClient();
  return {
    bind: (path: string) => ({
      onPointerEnter: () => prefetchRoute(client, path),
      onPointerDown: () => prefetchRoute(client, path),
    }),
    /** 弹出面板时把这一组都预取掉——面板停留的那一两秒正好用来拉数据。 */
    all: (segments: NavSegment[]) => {
      for (const segment of segments) {
        if (segment.ready && segment.path) prefetchRoute(client, segment.path);
      }
    },
  };
}

function segmentHref(scene: NavScene, segment: NavSegment) {
  return segment.ready && segment.path ? segment.path : `${scene.path}/${segment.key}`;
}

// ---- 桌面：左侧竖向导航 -------------------------------------------------------

function Sidebar({ manager }: { manager: boolean }) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const active = sceneOf(pathname);
  const [openKey, setOpenKey] = useState(active.key);

  // 跟着路由走：换场景时自动展开新场景，手动展开的保留到下次换页
  useEffect(() => setOpenKey(active.key), [active.key]);

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="功能导航">
      {SCENES.map((scene) => {
        const segments = visibleSegments(scene, manager);
        const isActive = scene.key === active.key;
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
                      <span className="flex-1 truncate">{segment.label}</span>
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

// ---- 手机：底部标签 + 上弹面板 -------------------------------------------------

interface MenuAnchor {
  scene: NavScene;
  /** 被点的那个标签的水平中点，用来把气泡对准它 */
  center: number;
  /** 标签栏顶边距离视口底部的距离，气泡就浮在它上面 */
  bottom: number;
}

const MENU_WIDTH = 176;
const EXIT_MS = 170;

/**
 * 从被点的那个标签正上方长出来的气泡菜单。
 *
 * 按 .claude/skills/apple-design 调过，几条关键的：
 * - 变换原点锚在触发它的那个标签上（不是气泡自己的中心），所以它是「从那个按钮里长出来」，
 *   而不是「在那个位置放大」。§7 spatial consistency。
 * - 进出走同一条路径：出场是入场的镜像（同一个原点缩回去），不是直接消失。
 *   东西从哪儿来就该回哪儿去，凭空消失会让人找不到它去了哪。
 * - 临界阻尼，不回弹：手指只是点了一下，没有甩出去的动量，回弹在这儿是假的。§4。
 * - 材质而不是色块：半透明 + 背景模糊，而且模糊半径跟着缩放一起动——
 *   「materialize, don't just fade」，让它像一层真的玻璃落下来，而不是一张图淡入。§12。
 */
function SceneMenu({
  anchor,
  segments,
  onClose,
}: {
  anchor: MenuAnchor;
  segments: NavSegment[];
  onClose: () => void;
}) {
  const { pathname } = useLocation();
  const [closing, setClosing] = useState(false);

  // 关闭要等出场动画走完再卸载，否则就是「啪」一下没了
  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && requestClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const left = Math.min(
    Math.max(8, anchor.center - MENU_WIDTH / 2),
    window.innerWidth - MENU_WIDTH - 8,
  );
  const caret = Math.min(Math.max(14, anchor.center - left), MENU_WIDTH - 14);

  // 边缘渐隐只在真的滚得动时才加——列表没超出还淡掉首尾，等于骗人说下面还有
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) setScrollable(list.scrollHeight > list.clientHeight + 1);
  }, [segments.length]);

  return (
    <div className="fixed inset-0 z-40 lg:hidden" onPointerDown={requestClose}>
      {/* 很轻的一层压暗：够把注意力收到菜单上，又不至于把下面的内容盖死 */}
      <div
        className={
          'absolute inset-0 bg-black/10 ' +
          (closing ? 'animate-[scrim-out_170ms_ease-out_both]' : 'animate-[scrim-in_200ms_ease-out]')
        }
      />
      <div
        role="menu"
        aria-label={`${anchor.scene.label}的功能`}
        style={{
          left,
          bottom: anchor.bottom + 10,
          width: MENU_WIDTH,
          // 原点钉在小三角上 = 钉在被点的那个标签上
          transformOrigin: `${caret}px bottom`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className={
          'fixed will-change-[transform,opacity] ' +
          (closing
            ? 'animate-[pop-out_170ms_cubic-bezier(0.4,0,1,1)_both]'
            : 'animate-[pop-in_280ms_cubic-bezier(0.32,0.72,0,1)_both]')
        }
      >
        <div
          ref={listRef}
          className={
            'pop-material max-h-[62vh] overflow-y-auto rounded-2xl ' +
            (scrollable ? 'pop-scroll ' : '') +
            (closing
              ? 'animate-[material-out_170ms_ease-out_both]'
              : 'animate-[material-in_280ms_cubic-bezier(0.32,0.72,0,1)_both]')
          }
        >
          {segments.map((segment) => {
            const href = segmentHref(anchor.scene, segment);
            const current = href === pathname;
            const ready = Boolean(segment.ready && segment.path);
            return (
              <SoftLink
                key={segment.key}
                to={href}
                active={current}
                onNavigate={requestClose}
                className={
                  'flex items-center gap-2 border-b border-border/70 px-3.5 py-3 text-[14px] ' +
                  'tracking-[0.01em] transition-colors duration-100 last:border-b-0 ' +
                  (current
                    ? 'bg-accent-soft/80 font-semibold text-accent'
                    : 'font-medium text-ink active:bg-ink/[0.06]')
                }
              >
                <span className="flex-1 truncate">{segment.label}</span>
                {ready ? null : <span className="text-[11px] text-warm">旧版</span>}
                {current ? <span className="text-accent">✓</span> : null}
              </SoftLink>
            );
          })}
        </div>
        {/* 指向被点标签的小三角，用同一种材质，不然会像贴上去的 */}
        <span
          style={{ left: caret }}
          className="pop-caret absolute bottom-0 -ml-[6px] h-3 w-3 translate-y-1/2 rotate-45"
        />
      </div>
    </div>
  );
}

function BottomTabs({
  manager,
  onOpenMenu,
}: {
  manager: boolean;
  onOpenMenu: (anchor: MenuAnchor) => void;
}) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const active = sceneOf(pathname);
  const navRef = useRef<HTMLElement>(null);

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      aria-label="主导航"
    >
      <div className="flex items-stretch">
        {SCENES.map((scene) => {
          const segments = visibleSegments(scene, manager);
          const isActive = scene.key === active.key;
          return (
            <button
              key={scene.key}
              type="button"
              onPointerEnter={() => prefetchOn(prefetch, scene)}
              // 按下就弹，不等抬手——等 click 的那一下延迟，手感立刻就塌了
              onPointerDown={(event) => {
                prefetchOn(prefetch, scene);
                if (!segments.length) {
                  soft(scene.path);
                  return;
                }
                const tab = event.currentTarget.getBoundingClientRect();
                const bar = navRef.current?.getBoundingClientRect();
                onOpenMenu({
                  scene,
                  center: tab.left + tab.width / 2,
                  bottom: window.innerHeight - (bar?.top ?? tab.top),
                });
              }}
              aria-haspopup={segments.length ? 'menu' : undefined}
              className={
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ' +
                'transition-[color,transform] duration-150 active:scale-[0.94] ' +
                (isActive ? 'font-medium text-accent' : 'text-ink-soft')
              }
            >
              <span className="text-[17px] leading-none">{scene.icon}</span>
              <span className="flex items-center gap-0.5">
                {scene.label}
                {/* 有下级的挂个小三角，让人知道点了会弹出来 */}
                {segments.length ? <span className="text-[7px] leading-none">▲</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function prefetchOn(prefetch: ReturnType<typeof usePrefetch>, scene: NavScene) {
  prefetch.bind(landingPath(scene)).onPointerEnter();
}

// ---- 外壳 ---------------------------------------------------------------------

export function Shell() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const [theme, setTheme] = useState(readTheme);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
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

      <div className="flex min-h-full flex-col lg:pl-[224px]">
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
            <button
              type="button"
              onClick={openPalette}
              aria-label="快速跳转"
              className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors duration-150 hover:bg-muted"
            >
              🔍
            </button>
            <Button
              variant="ghost"
              aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-9 shrink-0 px-2 text-[15px]"
            >
              {theme === 'dark' ? '☀' : '☾'}
            </Button>
            <Button variant="ghost" onClick={signOut} className="h-9 shrink-0 px-2 text-[12px]">
              退出
            </Button>
          </div>
        </header>

        {/* view-transition-name 只给主体，导航留在原地不参与淡入 */}
        <main className="flex-1 [view-transition-name:page]" key={segment?.key ?? scene.key}>
          <Outlet />
        </main>
      </div>

      <BottomTabs
        manager={manager}
        onOpenMenu={(anchor) => {
          prefetch.all(visibleSegments(anchor.scene, manager));
          setMenu(anchor);
        }}
      />

      {menu ? (
        <SceneMenu
          anchor={menu}
          segments={visibleSegments(menu.scene, manager)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** 还没搬到新客户端的分段：说清楚现状，给一个一键回旧版的出口。 */
export function LegacyBridge() {
  const { pathname } = useLocation();
  const scene = sceneOf(pathname);
  const segment = segmentOf(scene, pathname);
  if (!segment) return null;

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 lg:mx-0 lg:px-8 pb-24 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-4xl">{scene.icon}</span>
        <h1 className="text-xl font-semibold">{segment.label}还在旧版</h1>
        <p className="max-w-[420px] text-[13px] leading-relaxed text-ink-soft">
          新客户端正在一页一页搬，这个还没轮到。旧版功能完整，数据是同一份，
          在那边做的改动这边刷新就能看到。
        </p>
        <a
          href={legacyUrl(segment.legacy ?? '/')}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-[filter] duration-150 hover:brightness-110"
        >
          在旧版打开{segment.label} ↗
        </a>
      </div>
    </div>
  );
}
