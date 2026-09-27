import { useEffect, useRef, useState } from 'react';
import { PINNED } from '../lib/nav';
import { SoftLink } from './soft-link';

/**
 * 手机顶栏右上角的头像菜单：个人设置、深浅色、退出。
 * 「我的」从底部标签里拿掉之后，这些东西得有个去处——设置挂在头像后面是惯例，
 * 家里人不用学。问问小管家不在这里：它是天天用的工具，单独一个按钮摆在外面。
 */
export function AccountMenu({
  name,
  dark,
  onToggleTheme,
  onSignOut,
}: {
  name: string;
  dark: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const item =
    'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13.5px] transition-colors ' +
    'duration-100 active:bg-ink/[0.06]';

  return (
    // z-50 要高过下面那层遮罩，否则头像被自己的遮罩挡住，点第二下关不掉菜单
    <div ref={boxRef} className="relative z-50 shrink-0">
      <button
        type="button"
        aria-label="账号与设置"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-9 place-items-center rounded-full bg-muted text-[13px] font-medium text-ink-soft"
      >
        {name.slice(0, 1)}
      </button>

      {open ? (
        <>
          {/* 点外面关掉；压暗很轻，只是把注意力收过来 */}
          <div className="fixed inset-0 z-40 bg-black/10" onPointerDown={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="账号与设置"
            className="pop-material absolute right-0 top-[calc(100%+6px)] z-50 w-40 overflow-hidden rounded-xl animate-[pop-in_200ms_cubic-bezier(0.32,0.72,0,1)_both]"
            style={{ transformOrigin: 'top right' }}
          >
            <p className="truncate border-b border-border/60 px-3 py-2 text-[12px] text-ink-soft">
              {name}
            </p>
            <SoftLink
              to={PINNED[1].path}
              onNavigate={() => setOpen(false)}
              className={item}
            >
              <span>{PINNED[1].icon}</span>
              <span>{PINNED[1].label}</span>
            </SoftLink>
            <button
              type="button"
              aria-label={dark ? '切换到浅色' : '切换到深色'}
              className={item}
              onClick={() => {
                onToggleTheme();
                setOpen(false);
              }}
            >
              <span>{dark ? '☀' : '☾'}</span>
              <span>{dark ? '浅色模式' : '深色模式'}</span>
            </button>
            <button
              type="button"
              aria-label="退出"
              className={`${item} border-t border-border/60 text-danger`}
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              <span>⏻</span>
              <span>退出登录</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
