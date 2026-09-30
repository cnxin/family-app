import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { MapBounds } from '@family/shared';
import { animateSpring, rubberband } from '../../lib/spring';

// 地图的缩放和平移（apple-design §2、§5、§9）：单指 / 鼠标拖动平移、双指捏合缩放、滚轮缩放；
// 跟手（记住抓取点）、松手带惯性、越界有橡皮筋、松手弹回；动画随时可以被下一次触摸打断。

export interface MapView {
  scale: number;
  x: number;
  y: number;
}

/** 手指动过这么多才算拖，不然是点按（交给房间 / 柜子的 onClick） */
const SLOP = 6;
/** 允许拖出边界的余量（容器尺寸的比例） */
const OVERSCROLL = 0.35;

interface Gesture {
  pointers: Map<number, { x: number; y: number }>;
  start: MapView;
  /** 单指：起点；双指：起始中点和间距 */
  origin: { x: number; y: number; distance: number };
  moved: boolean;
  history: { x: number; y: number; t: number }[];
}

export function useMapViewport(box: { w: number; h: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const current = useRef<MapView | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const stop = useRef<() => void>(() => undefined);
  const suppressClick = useRef(false);
  /** 手指 / 鼠标正在拖、捏：浮动工具条这时先藏起来（地图编辑器 v2 §1.3） */
  const [panning, setPanning] = useState(false);
  const touched = useRef(false);
  const frame = useRef(0);

  const fitScale = size ? Math.min(size.w / box.w, size.h / box.h) * 0.94 : 1;
  const limits = { min: fitScale * 0.85, max: fitScale * 10 };

  const commit = useCallback((next: MapView) => {
    current.current = next;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setView(next));
  }, []);

  const fitted = useCallback((): MapView | null => {
    if (!size) return null;
    return { scale: fitScale, x: (size.w - box.w * fitScale) / 2, y: (size.h - box.h * fitScale) / 2 };
  }, [size, fitScale, box.w, box.h]);

  /** 某个缩放下平移的合法范围：内容比容器大时可以拖到边，小时围着居中位置留一点余量 */
  const range = useCallback(
    (scale: number) => {
      const w = size?.w ?? 0;
      const h = size?.h ?? 0;
      const axis = (viewport: number, content: number) => {
        const pad = viewport * OVERSCROLL;
        if (content <= viewport) {
          const center = (viewport - content) / 2;
          return { lo: center - pad, hi: center + pad };
        }
        return { lo: viewport - content - pad, hi: pad };
      };
      return { x: axis(w, box.w * scale), y: axis(h, box.h * scale) };
    },
    [size, box.w, box.h],
  );

  const soften = useCallback(
    (next: MapView): MapView => {
      const r = range(next.scale);
      const band = (value: number, lo: number, hi: number, dimension: number) =>
        value < lo ? lo - rubberband(lo - value, dimension) : value > hi ? hi + rubberband(value - hi, dimension) : value;
      return { scale: next.scale, x: band(next.x, r.x.lo, r.x.hi, size?.w ?? 1), y: band(next.y, r.y.lo, r.y.hi, size?.h ?? 1) };
    },
    [range, size],
  );

  const clampView = useCallback(
    (next: MapView): MapView => {
      const scale = Math.min(limits.max, Math.max(limits.min, next.scale));
      // 缩放被夹住时围绕容器中心换算，免得内容跳走
      const cx = (size?.w ?? 0) / 2;
      const cy = (size?.h ?? 0) / 2;
      const x = cx - ((cx - next.x) * scale) / next.scale;
      const y = cy - ((cy - next.y) * scale) / next.scale;
      const r = range(scale);
      return { scale, x: Math.min(r.x.hi, Math.max(r.x.lo, x)), y: Math.min(r.y.hi, Math.max(r.y.lo, y)) };
    },
    [limits.max, limits.min, range, size],
  );

  /** 用一根弹簧（0 → 1）同时把缩放和平移带到目标，随时可被打断 */
  const animateTo = useCallback(
    (target: MapView, velocity = 0) => {
      stop.current();
      const from = current.current ?? target;
      stop.current = animateSpring(
        0,
        1,
        velocity,
        (t) =>
          commit({
            scale: from.scale + (target.scale - from.scale) * t,
            x: from.x + (target.x - from.x) * t,
            y: from.y + (target.y - from.y) * t,
          }),
        () => commit(target),
        { response: 0.35, damping: 1 },
      );
    },
    [commit],
  );

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 第一次量到尺寸、或者尺寸大变（转屏、侧栏收起）且用户还没动过：重新铺满。
  // 小变化（工具条多一行、抽屉、键盘）保持中心不动——不然点一下选中，整张图就跳一下
  const lastSize = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const next = fitted();
    if (!next || !size) return;
    const before = lastSize.current;
    lastSize.current = size;
    const big = !before || Math.abs(size.w - before.w) > before.w * 0.25 || Math.abs(size.h - before.h) > before.h * 0.25;
    if (!current.current || (big && !touched.current)) {
      current.current = next;
      setView(next);
      return;
    }
    const shifted = before
      ? { ...current.current, x: current.current.x + (size.w - before.w) / 2, y: current.current.y + (size.h - before.h) / 2 }
      : current.current;
    commit(big ? clampView(shifted) : shifted);
  }, [fitted, clampView, commit, size]);

  useEffect(() => () => {
    stop.current();
    cancelAnimationFrame(frame.current);
  }, []);

  const local = useCallback(
    (clientX: number, clientY: number) => {
      const rect = container.current?.getBoundingClientRect();
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
    },
    [],
  );

  /** 屏幕坐标 → 地图坐标（viewBox 里） */
  const toMap = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const v = current.current ?? { scale: 1, x: 0, y: 0 };
      const p = local(clientX, clientY);
      return [(p.x - v.x) / v.scale, (p.y - v.y) / v.scale];
    },
    [local],
  );

  const zoomAround = useCallback(
    (factor: number, point: { x: number; y: number }, animated = false) => {
      const v = current.current;
      if (!v) return;
      const scale = Math.min(limits.max, Math.max(limits.min, v.scale * factor));
      const next = clampView({ scale, x: point.x - ((point.x - v.x) * scale) / v.scale, y: point.y - ((point.y - v.y) * scale) / v.scale });
      touched.current = true;
      if (animated) animateTo(next);
      else {
        stop.current();
        commit(next);
      }
    },
    [limits.max, limits.min, clampView, animateTo, commit],
  );

  // 滚轮 / 触控板捏合：要 passive: false 才能拦住页面滚动
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const speed = event.ctrlKey ? 0.01 : 0.0018;
      zoomAround(Math.exp(-event.deltaY * speed), local(event.clientX, event.clientY));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAround, local]);

  const settle = useCallback(
    (velocity: { x: number; y: number }) => {
      const v = current.current;
      if (!v) return;
      const target = clampView(v);
      const outside = target.scale !== v.scale || Math.abs(target.x - v.x) > 0.5 || Math.abs(target.y - v.y) > 0.5;
      if (outside || Math.hypot(velocity.x, velocity.y) < 0.05) {
        animateTo(target);
        return;
      }
      // 惯性：按 apple-design 的指数衰减（每毫秒 0.998），撞到边界那一轴停下
      stop.current();
      let vx = velocity.x;
      let vy = velocity.y;
      let last = performance.now();
      let id = 0;
      const tick = (now: number) => {
        const dt = Math.min(32, now - last);
        last = now;
        const decay = Math.pow(0.998, dt);
        vx *= decay;
        vy *= decay;
        const base = current.current!;
        const r = range(base.scale);
        let x = base.x + vx * dt;
        let y = base.y + vy * dt;
        if (x < r.x.lo || x > r.x.hi) {
          x = Math.min(r.x.hi, Math.max(r.x.lo, x));
          vx = 0;
        }
        if (y < r.y.lo || y > r.y.hi) {
          y = Math.min(r.y.hi, Math.max(r.y.lo, y));
          vy = 0;
        }
        commit({ scale: base.scale, x, y });
        if (Math.hypot(vx, vy) > 0.02) id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      stop.current = () => cancelAnimationFrame(id);
    },
    [animateTo, clampView, commit, range],
  );

  const restart = (g: Gesture) => {
    const points = [...g.pointers.values()];
    g.start = current.current!;
    if (points.length >= 2) {
      const [a, b] = points;
      g.origin = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    } else if (points.length === 1) {
      g.origin = { ...points[0], distance: 1 };
    }
    g.history = [];
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // 上一次拖动留下的「别算点击」只管紧跟着的那个 click；触摸拖完浏览器不补 click，标记会残留，新手势开始就清掉
    suppressClick.current = false;
    if (!current.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stop.current();
    const point = local(event.clientX, event.clientY);
    let g = gesture.current;
    if (!g) {
      g = { pointers: new Map(), start: current.current, origin: { ...point, distance: 1 }, moved: false, history: [] };
      gesture.current = g;
      const move = (e: globalThis.PointerEvent) => onMove(e);
      const up = (e: globalThis.PointerEvent) => {
        const active = gesture.current;
        if (!active) return;
        active.pointers.delete(e.pointerId);
        if (active.pointers.size > 0) {
          restart(active);
          return;
        }
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        gesture.current = null;
        if (!active.moved) return;
        setPanning(false);
        suppressClick.current = true;
        const recent = active.history.filter((h) => e.timeStamp - h.t < 100);
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = first && last ? last.t - first.t : 0;
        settle(dt > 0 ? { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt } : { x: 0, y: 0 });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
    g.pointers.set(event.pointerId, point);
    restart(g);
  };

  const onMove = (event: globalThis.PointerEvent) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(event.pointerId)) return;
    g.pointers.set(event.pointerId, local(event.clientX, event.clientY));
    const points = [...g.pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const raw = g.start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.origin.distance);
      // 捏过头也跟一点，但越来越费劲（橡皮筋），松手弹回上下限
      const scale =
        raw > limits.max ? limits.max * (1 + rubberband(raw / limits.max - 1, 1, 0.4)) :
        raw < limits.min ? limits.min / (1 + rubberband(limits.min / raw - 1, 1, 0.4)) : raw;
      if (!g.moved) setPanning(true);
      g.moved = true;
      touched.current = true;
      commit(soften({
        scale,
        x: mid.x - ((g.origin.x - g.start.x) * scale) / g.start.scale,
        y: mid.y - ((g.origin.y - g.start.y) * scale) / g.start.scale,
      }));
      return;
    }
    const [p] = points;
    const dx = p.x - g.origin.x;
    const dy = p.y - g.origin.y;
    if (!g.moved && Math.hypot(dx, dy) < SLOP) return;
    if (!g.moved) setPanning(true);
    g.moved = true;
    touched.current = true;
    g.history.push({ x: p.x, y: p.y, t: event.timeStamp });
    if (g.history.length > 12) g.history.shift();
    commit(soften({ scale: g.start.scale, x: g.start.x + dx, y: g.start.y + dy }));
  };

  /** 拖完 / 捏完那一下的 click 不算点房间 */
  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  /**
   * 把一块区域（房间、命中的柜子）挪到看得见的那块中间并放大到看得清。
   * inset：被抽屉盖住的边（桌面右侧抽屉、手机底部抽屉），对准时让开。
   */
  const focus = useCallback(
    (bounds: MapBounds, maxZoom = 3, inset: { right?: number; bottom?: number } = {}) => {
      if (!size) return;
      const w = Math.max(120, size.w - (inset.right ?? 0));
      const h = Math.max(120, size.h - (inset.bottom ?? 0));
      const bw = Math.max(40, bounds.maxX - bounds.minX);
      const bh = Math.max(40, bounds.maxY - bounds.minY);
      const scale = Math.min(fitScale * maxZoom, Math.max(fitScale, Math.min(w / bw, h / bh) * 0.55));
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      touched.current = true;
      // 让开抽屉之后可以越过平时的平移范围（否则靠边的房间对不到可见区中间）
      const target = { scale, x: w / 2 - cx * scale, y: h / 2 - cy * scale };
      animateTo(inset.right || inset.bottom ? target : clampView(target));
    },
    [size, fitScale, animateTo, clampView],
  );

  const reset = useCallback(() => {
    const next = fitted();
    if (next) animateTo(next);
  }, [fitted, animateTo]);

  const zoomBy = useCallback(
    (factor: number) => size && zoomAround(factor, { x: size.w / 2, y: size.h / 2 }, true),
    [size, zoomAround],
  );

  return { container, view, size, fitScale, panning, toMap, focus, reset, zoomBy, handlers: { onPointerDown, onClickCapture } };
}
