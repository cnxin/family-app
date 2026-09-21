import { useEffect, useRef, useState } from 'react';
import type { ShelfModuleKey } from '@family/contracts';
import type { NavSegment } from '../lib/nav';
import { usePins, PIN_LIMIT } from '../lib/pins';
import { usePrefetch } from './nav-prefetch';
import { SoftLink } from './soft-link';

export function HomeTile({ segment, editing = false, onHide, busy = false }: {
  segment: NavSegment & { key: ShelfModuleKey };
  editing?: boolean;
  onHide?: () => void;
  busy?: boolean;
}) {
  const prefetch = usePrefetch();
  const { pins, toggle } = usePins();
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const hideButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const pinned = pins.includes(segment.key);
  const atLimit = !pinned && pins.length >= PIN_LIMIT;
  const stopHold = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!menu) return;
    hideButton.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  if (!segment.path) return null;
  return (
    <div ref={root} className="relative min-w-0" data-home-tile={segment.key}
      onContextMenu={(event) => { if (onHide && !editing) { event.preventDefault(); setMenu(true); } }}
      onPointerDown={(event) => {
        held.current = false;
        start.current = { x: event.clientX, y: event.clientY };
        if (!onHide || editing || event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return;
        timer.current = setTimeout(() => { held.current = true; setMenu(true); }, 550);
      }}
      onPointerUp={stopHold} onPointerCancel={stopHold}
      onPointerMove={(event) => {
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) stopHold();
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }}
      onClickCapture={(event) => { if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false; } }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(false); menuButton.current?.focus(); }
      }}>
      <SoftLink to={segment.path} {...prefetch.bind(segment.path)} aria-label={segment.label}
        className={`flex h-full min-w-0 flex-col items-center gap-2 rounded-xl border border-border bg-surface p-2.5 text-center transition-colors duration-150 hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 lg:p-4 ${editing || onHide ? 'pt-11 lg:pt-11' : ''}`}>
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-xl font-semibold text-accent">{segment.glyph}</span>
        <span className="max-w-full text-[13px] font-medium leading-5 text-ink">{segment.label}</span>
      </SoftLink>
      {editing ? (
        <button type="button" onClick={() => toggle(segment.key)} disabled={atLimit}
          aria-label={`${pinned ? '取消置顶' : '置顶'}${segment.label}`} aria-pressed={pinned}
          title={atLimit ? '最多钉住 4 个，请先取消一个置顶' : undefined}
          aria-describedby={atLimit ? 'pin-limit-hint' : undefined}
          className="absolute right-0 top-0 grid size-11 place-items-center rounded-lg text-accent hover:bg-muted disabled:text-ink-soft disabled:opacity-40">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"><path d="m8 3 8 0-1 7 3 3v2H6v-2l3-3-1-7ZM12 15v7" /></svg>
        </button>
      ) : onHide ? (
        <button ref={menuButton} type="button" aria-label={`${segment.label}选项`} aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(!menu)} className="absolute right-0 top-0 size-11 rounded-lg text-ink-soft hover:bg-muted">···</button>
      ) : null}
      {menu && onHide ? (
        <div role="menu" aria-label={`${segment.label}选项`} className="absolute inset-x-0 top-11 z-10 rounded-lg border border-border bg-surface p-1 shadow-lg">
          <button ref={hideButton} type="button" role="menuitem" disabled={busy}
            onClick={() => { setMenu(false); onHide(); }} className="min-h-11 w-full rounded-md text-sm text-ink hover:bg-muted disabled:opacity-50">收起来</button>
        </div>
      ) : null}
    </div>
  );
}
