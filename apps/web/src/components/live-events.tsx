import { useLiveEvents } from '../lib/events';

/**
 * 外壳级实时更新：挂上就订阅 /events。连不上超过 30 秒在顶部给一条可关闭的提示，
 * 恢复后自动消失；不弹窗，不挡操作。
 */
export function LiveEvents() {
  const { paused, dismiss } = useLiveEvents();
  if (!paused) return null;
  return (
    <div
      role="status"
      data-live-paused
      className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-40 flex justify-center px-4 lg:left-[224px]"
    >
      <div className="flex max-w-md items-center gap-2 rounded-full border border-border bg-surface/95 py-1 pl-4 pr-1 text-[13px] text-ink-soft shadow-sm backdrop-blur">
        <span>实时更新已暂停，连上后会自动补齐</span>
        <button
          type="button"
          aria-label="关闭实时更新提示"
          onClick={dismiss}
          className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
