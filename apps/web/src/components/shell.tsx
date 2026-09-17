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
  return (path: string) => ({
    onPointerEnter: () => prefetchRoute(client, path),
    onPointerDown: () => prefetchRoute(client, path),
  });
}

function SceneBar() {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const current = sceneOf(pathname);
  return (
    <nav className="mx-2 hidden min-w-0 flex-1 items-center gap-1 sm:flex" aria-label="场景">
      {SCENES.map((scene) => {
        const target = landingPath(scene);
        const active = scene.key === current.key;
        return (
          <SoftLink
            key={scene.key}
            to={target}
            active={active}
            {...prefetch(target)}
            className={
              'shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ' +
              (active
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-soft hover:bg-muted')
            }
          >
            {scene.label}
          </SoftLink>
        );
      })}
    </nav>
  );
}

function SegmentBar({ scene, segments }: { scene: NavScene; segments: NavSegment[] }) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  if (!segments.length) return null;

  return (
    <div className="border-t border-border/60">
      <div
        className="flex w-full gap-1 overflow-x-auto px-3 py-2 sm:px-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="分段"
      >
        {segments.map((segment) => {
          const ready = Boolean(segment.ready && segment.path);
          const target = ready ? segment.path! : `${scene.path}/${segment.key}`;
          const active = target === pathname;
          return (
            <SoftLink
              key={segment.key}
              to={target}
              active={active}
              {...(ready ? prefetch(target) : {})}
              className={
                'shrink-0 rounded-full px-3 py-1 text-[13px] transition-colors duration-150 ' +
                (active
                  ? 'bg-ink font-medium text-bg'
                  : 'text-ink-soft hover:bg-muted')
              }
            >
              {segment.label}
              {/* 还没搬过来的挂一个小点，点进去是旧版入口 */}
              {ready ? null : <span className="ml-1 text-warm">·</span>}
            </SoftLink>
          );
        })}
      </div>
    </div>
  );
}

function BottomTabs() {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      aria-label="主导航"
    >
      <div className="flex items-stretch">
        {SCENES.map((scene) => {
          const target = landingPath(scene);
          const active =
            scene.path === '/' ? pathname === '/' : pathname.startsWith(scene.path);
          return (
            <SoftLink
              key={scene.key}
              to={target}
              active={active}
              {...prefetch(target)}
              className={
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors duration-150 ' +
                (active ? 'font-medium text-accent' : 'text-ink-soft')
              }
            >
              <span className="text-[17px] leading-none">{scene.icon}</span>
              {scene.label}
            </SoftLink>
          );
        })}
      </div>
    </nav>
  );
}

export function Shell() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const soft = useSoftNavigate();
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);

  const manager = session?.member.role !== 'member';
  const scene = sceneOf(pathname);
  const segments = visibleSegments(scene, manager);
  const segment = segmentOf(scene, pathname);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-xl">
        <div className="flex h-14 w-full items-center gap-1 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => soft('/')}
            className="shrink-0 text-sm font-semibold"
          >
            小管家
          </button>
          <SceneBar />
          <button
            type="button"
            onClick={openPalette}
            aria-label="快速跳转"
            className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] text-ink-soft transition-colors duration-150 hover:bg-muted"
          >
            <span>搜索</span>
            <kbd className="hidden rounded border border-border px-1 font-sans text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>
          <Button
            variant="ghost"
            aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-8 shrink-0 px-2 text-[15px]"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </Button>
          <Button variant="ghost" onClick={signOut} className="h-8 shrink-0 px-3 text-[13px]">
            退出
          </Button>
        </div>
        <SegmentBar scene={scene} segments={segments} />
      </header>

      {/* view-transition-name 只给主体，顶栏和底栏留在原地不参与淡入，切页时不会整屏闪 */}
      <main className="flex-1 [view-transition-name:page]" key={segment?.key ?? scene.key}>
        <Outlet />
      </main>

      <BottomTabs />
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
    <div className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-10">
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
