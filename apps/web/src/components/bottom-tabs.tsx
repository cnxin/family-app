import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CENTER_TAB_KEY,
  inScene,
  landingPath,
  mobileTabs,
  sceneOf,
  visibleSegments,
} from '../lib/nav';
import type { NavScene, NavSegment } from '../lib/nav';
import { segmentHref, usePrefetch } from './nav-prefetch';
import { SoftLink, useSoftNavigate } from './soft-link';

// ---- 手机：底部标签 + 上弹面板 -------------------------------------------------

interface MenuAnchor {
  scene: NavScene;
  /** 被点的那个标签的水平中点，用来把气泡对准它 */
  center: number;
  /** 标签栏顶边距离视口底部的距离，气泡就浮在它上面 */
  bottom: number;
}

// 菜单宽度不写死：中文标签大多两三个字，固定宽度会让文字孤零零贴在左边，
// 右边空一大条——那条多余的空白就是「不够优雅」的来源。让盒子贴着文字长，
// 只给下限（太窄点不准）和上限（别横穿屏幕）。
// 右边不放任何标记：勾和圆点各占一条空档，而它们要说的事情用颜色说就够了——
// 当前项是强调色，按下去背景变一下。少一列标记，宽度直接少一半。
const MENU_MIN = 72;
const MENU_MAX_VW = 0.62;
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

  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  // 量完再定位：useLayoutEffect 在绘制前跑，所以不会看到先歪一下再跳过去。
  // 顺带量一下列表到底滚不滚得动——没超出还淡掉首尾，等于骗人说下面还有。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    setWidth(list.offsetWidth);
    setScrollable(list.scrollHeight > list.clientHeight + 1);
  }, [segments]);

  const measured = width || MENU_MIN;
  const left = Math.min(
    Math.max(8, anchor.center - measured / 2),
    window.innerWidth - measured - 8,
  );
  const caret = Math.min(Math.max(13, anchor.center - left), measured - 13);

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
          style={{ minWidth: MENU_MIN, maxWidth: `${MENU_MAX_VW * 100}vw` }}
          className={
            'pop-material w-max max-h-[56vh] overflow-y-auto rounded-xl ' +
            (scrollable ? 'pop-scroll ' : '') +
            (closing
              ? 'animate-[material-out_170ms_ease-out_both]'
              : 'animate-[material-in_280ms_cubic-bezier(0.32,0.72,0,1)_both]')
          }
        >
          {segments.map((segment) => {
            const href = segmentHref(anchor.scene, segment);
            const current = href === pathname;
            return (
              <SoftLink
                key={segment.key}
                to={href}
                active={current}
                onNavigate={requestClose}
                className={
                  'relative flex items-center justify-center px-3 py-[9px] text-[13.5px] ' +
                  'tracking-[0.01em] transition-colors duration-100 ' +
                  // 分隔线内缩一点，不顶到两边——顶满会把每一行框成一个格子
                  'after:pointer-events-none after:absolute after:inset-x-2.5 after:bottom-0 ' +
                  'after:h-px after:bg-border/60 last:after:hidden ' +
                  (current
                    ? 'font-semibold text-accent'
                    : 'font-medium text-ink active:bg-ink/[0.06]')
                }
              >
                <span className="truncate">{segment.label}</span>
              </SoftLink>
            );
          })}
        </div>
        {/* 指向被点标签的小三角，用同一种材质，不然会像贴上去的 */}
        <span
          style={{ left: caret }}
          className="pop-caret absolute bottom-0 -ml-[5px] h-2.5 w-2.5 translate-y-1/2 rotate-45"
        />
      </div>
    </div>
  );
}

function TabBar({
  manager,
  onOpenMenu,
}: {
  manager: boolean;
  onOpenMenu: (anchor: MenuAnchor) => void;
}) {
  const { pathname } = useLocation();
  const prefetch = usePrefetch();
  const soft = useSoftNavigate();
  const here = inScene(pathname);
  const active = sceneOf(pathname);
  const navRef = useRef<HTMLElement>(null);

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      aria-label="主导航"
    >
      {/* 中间那个按钮要凸出到栏外面，所以这一行不能裁剪 */}
      <div className="flex items-stretch">
        {mobileTabs().map((scene) => {
          const segments = visibleSegments(scene, manager);
          const isActive = here && scene.key === active.key;
          const center = scene.key === CENTER_TAB_KEY;

          // 按下就弹，不等抬手——等 click 的那一下延迟，手感立刻就塌了
          const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
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
          };

          if (center) {
            return (
              <button
                key={scene.key}
                type="button"
                aria-label={scene.label}
                aria-current={isActive ? 'page' : undefined}
                onPointerEnter={() => prefetchOn(prefetch, scene)}
                onPointerDown={onPointerDown}
                className="flex flex-1 flex-col items-center gap-0.5 pb-2 pt-1 transition-transform duration-150 active:scale-[0.92]"
              >
                <span
                  className={
                    // 从栏里长出来一块：环用页面底色描一圈，看着像浮在上面而不是贴上去
                    '-mt-6 grid size-[52px] place-items-center rounded-full text-[22px] leading-none ' +
                    'shadow-[0_6px_16px_rgba(0,0,0,0.18)] ring-4 ring-bg transition-colors duration-150 ' +
                    (isActive ? 'bg-accent text-white' : 'bg-surface text-ink')
                  }
                >
                  {scene.icon}
                </span>
                <span
                  className={
                    'text-[11px] ' + (isActive ? 'font-medium text-accent' : 'text-ink-soft')
                  }
                >
                  {scene.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={scene.key}
              type="button"
              onPointerEnter={() => prefetchOn(prefetch, scene)}
              onPointerDown={onPointerDown}
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

/** 底部标签 + 它弹出来的那个面板，状态在这儿闭环，外壳只管摆一个位置。 */
export function BottomTabs({ manager }: { manager: boolean }) {
  const prefetch = usePrefetch();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  return (
    <>
      <TabBar
        manager={manager}
        onOpenMenu={(anchor) => {
          // 面板停留的那一两秒正好用来把这一组数据拉回来
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
    </>
  );
}
