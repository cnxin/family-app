import { useEffect, useState } from 'react';
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

function SceneSheet({
  scene,
  segments,
  onClose,
}: {
  scene: NavScene;
  segments: NavSegment[];
  onClose: () => void;
}) {
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
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
      className="fixed inset-0 z-40 lg:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${scene.label}的功能`}
        className="absolute inset-x-0 bottom-0 animate-[sheet-up_220ms_cubic-bezier(0,0,0.2,1)] rounded-t-2xl border-t border-border bg-surface pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-2xl"
      >
        <button
          type="button"
          aria-label="收起"
          onClick={onClose}
          className="flex w-full justify-center py-2.5"
        >
          <span className="h-1 w-9 rounded-full bg-border" />
        </button>
        <p className="px-5 pb-1 pt-3 text-[13px] font-medium text-ink-soft">
          {scene.icon} {scene.label}
        </p>
        <div className="max-h-[56vh] overflow-y-auto px-2 pb-2">
          {segments.map((segment) => {
            const href = segmentHref(scene, segment);
            const current = href === pathname;
            const ready = Boolean(segment.ready && segment.path);
            return (
              <SoftLink
                key={segment.key}
                to={href}
                active={current}
                onNavigate={onClose}
                className={
                  'flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] transition-colors duration-150 ' +
                  (current ? 'bg-accent-soft font-medium text-accent' : 'text-ink active:bg-muted')
                }
              >
                <span className="flex-1">{segment.label}</span>
                {ready ? null : <span className="text-[12px] text-warm">旧版</span>}
                {current ? <span className="text-accent">✓</span> : null}
              </SoftLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BottomTabs({ manager, onOpenSheet }: { manager: boolean; onOpenSheet: (scene: NavScene) => void }) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const active = sceneOf(pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
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
              {...prefetch.bind(landingPath(scene))}
              onClick={() => (segments.length ? onOpenSheet(scene) : soft(scene.path))}
              aria-haspopup={segments.length ? 'menu' : undefined}
              className={
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors duration-150 ' +
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

// ---- 外壳 ---------------------------------------------------------------------

export function Shell() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const [theme, setTheme] = useState(readTheme);
  const [sheet, setSheet] = useState<NavScene | null>(null);
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
        onOpenSheet={(next) => {
          prefetch.all(visibleSegments(next, manager));
          setSheet(next);
        }}
      />

      {sheet ? (
        <SceneSheet
          scene={sheet}
          segments={visibleSegments(sheet, manager)}
          onClose={() => setSheet(null)}
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
    <div className="mx-auto w-full max-w-[760px] px-4 lg:mx-0 lg:px-8 pb-24 pt-10">
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
