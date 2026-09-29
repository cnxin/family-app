// 详情面板通用控件的纯函数（smart-home-redesign §9.4、§9.6）：数值取整到步长、选项怎么摆、
// 发出去的命令什么时候算「回推到了」。组件和单测共用，不碰 DOM。

/** 连按 / 键盘调节停手多久才发（温度步进、滑块的方向键）。 */
export const COMMIT_IDLE_MS = 600;
/** 发出后最多等设备回报多久；超时只提示，不回滚显示（显示永远跟 HA 走）。 */
export const PENDING_TIMEOUT_MS = 8_000;
/** select 选项不超过这么多用分段，再多用下拉。 */
export const SEGMENTED_MAX = 4;

function decimalsOf(step: number) {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** 收进 [min, max]，再对齐到从 min 起的步长（避开 0.1 + 0.2 这类浮点尾巴）。 */
export function snapToStep(value: number, min: number, max: number, step: number) {
  const safeStep = step > 0 ? step : 1;
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / safeStep) * safeStep;
  const decimals = Math.max(decimalsOf(safeStep), decimalsOf(min));
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}

/** 数值 + 单位的写法：温度、百分比贴着写，其余空一格。 */
export function formatWithUnit(value: number, unit: string | null, step = 1) {
  const text = value.toFixed(decimalsOf(step));
  if (!unit) return text;
  return /^[%°]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

export function choiceLayout(count: number): 'segmented' | 'dropdown' {
  return count <= SEGMENTED_MAX ? 'segmented' : 'dropdown';
}

export interface PendingEntry {
  requestId: string;
  /** 发出那一刻这个实体的 lastUpdated：它一变就算回推到了（不和 HA 的时钟比，免得两边时钟不齐） */
  baseline: string | null;
  value: unknown;
}

/** 哪些锁可以放了：这个实体的 lastUpdated 已经不是发出时的那个值。还没读到状态（undefined）的不放。 */
export function releasedEntities(pending: Record<string, PendingEntry>, lastUpdated: Record<string, string | null | undefined>) {
  return Object.entries(pending)
    .filter(([entityId, entry]) => {
      const now = lastUpdated[entityId];
      return now !== undefined && now !== entry.baseline;
    })
    .map(([entityId]) => entityId);
}
