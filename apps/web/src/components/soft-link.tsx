import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * React Router 的 `viewTransition` 属性只在数据路由（createBrowserRouter）下生效，
 * 我们用的是 <BrowserRouter> + <Routes>，加了也不会调用 startViewTransition
 * （实测 viewTransitionCalls 是 0）。所以这里自己包一层：
 * 在 startViewTransition 的回调里 flushSync 掉导航，浏览器才能抓到前后两帧。
 */
export function useSoftNavigate() {
  const navigate = useNavigate();
  return (to: string) => {
    if (!document.startViewTransition || reducedMotion()) {
      navigate(to);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => navigate(to));
    });
  };
}

/**
 * 仍然是真的 <a>：⌘ 点击能开新标签页、右键能复制链接、读屏器读出来是链接。
 * 只有普通左键点击才走软导航。
 */
export function SoftLink({
  to,
  active,
  className,
  children,
  onNavigate,
  ...rest
}: {
  to: string;
  active?: boolean;
  className?: string;
  children: ReactNode;
  /** 导航之后再执行，比如关掉弹出面板 */
  onNavigate?: () => void;
  onPointerEnter?: () => void;
  onPointerDown?: () => void;
  'aria-label'?: string;
}) {
  const soft = useSoftNavigate();
  return (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        soft(to);
        onNavigate?.();
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
