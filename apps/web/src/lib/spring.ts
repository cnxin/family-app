// 一个很小的弹簧（apple-design §3~§5）：从当前位置和当前速度出发、随时可以被打断重新瞄准，
// 松手时把手指速度交给它，用速度投射决定停哪一档。不引动画库。

export interface SpringOptions {
  /** 一次振荡大约多久（秒）；sheet 用 0.3 左右 */
  response?: number;
  /** 阻尼比：1 = 临界阻尼（不回弹），sheet 用 0.8~1 */
  damping?: number;
}

/** 按 apple-design 的指数衰减投射：手指以 velocity（px/s）松开，元素会「甩」到多远。 */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** 越界的橡皮筋：越拉越费劲，不会撞墙。 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension;
}

/**
 * 从 from 以 velocity 动到 to，每帧回调当前值；返回一个 stop()（打断用，停在当前位置）。
 * prefers-reduced-motion 时直接跳到终点。
 */
export function animateSpring(
  from: number,
  to: number,
  velocity: number,
  onFrame: (value: number, velocity: number) => void,
  onDone: () => void,
  { response = 0.3, damping = 0.9 }: SpringOptions = {},
) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    onFrame(to, 0);
    onDone();
    return () => undefined;
  }
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let position = from;
  let speed = velocity;
  let last = performance.now();
  let frame = 0;
  let stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    // 帧间隔过长（切后台回来）时按小步多算几次，别一步飞出去
    let elapsed = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (elapsed > 0) {
      const dt = Math.min(elapsed, 1 / 240);
      const force = -stiffness * (position - to) - friction * speed;
      speed += force * dt;
      position += speed * dt;
      elapsed -= dt;
    }
    if (Math.abs(position - to) < 0.5 && Math.abs(speed) < 10) {
      onFrame(to, 0);
      onDone();
      return;
    }
    onFrame(position, speed);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
