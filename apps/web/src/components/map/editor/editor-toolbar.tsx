import type { ReactNode } from 'react';
import { Button } from '../../ui';

// 编辑器那条固定工具栏（地图编辑器 v2 §1.2）：桌面顶部居中浮动胶囊，手机底部一条（拇指够得着、让开安全区）。

export interface EditorTool {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** 在它前面画一道分隔（撤销 / 重做和工具分开） */
  separated?: boolean;
}

export function EditorToolbar({ tools, desktop }: { tools: EditorTool[]; desktop: boolean }) {
  if (desktop) {
    return (
      <div
        role="toolbar"
        aria-label="编辑工具"
        className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-border bg-surface/88 p-1 shadow-lg backdrop-blur-xl"
      >
        {tools.map((tool) => (
          <span key={tool.key} className="flex items-center">
            {tool.separated ? <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" /> : null}
            <button
              type="button"
              aria-pressed={tool.active}
              disabled={tool.disabled}
              onClick={tool.onClick}
              className={
                'flex h-10 items-center gap-1.5 rounded-xl px-3 text-[14px] transition-colors duration-150 disabled:opacity-35 ' +
                (tool.active ? 'bg-accent text-white' : 'text-ink hover:bg-muted')
              }
            >
              <span aria-hidden="true">{tool.icon}</span>
              {tool.label}
            </button>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label="编辑工具"
      className="absolute inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom))] z-20 flex items-stretch justify-around rounded-[20px] border border-border bg-surface/88 p-1 shadow-lg backdrop-blur-xl"
    >
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          aria-pressed={tool.active}
          disabled={tool.disabled}
          onClick={tool.onClick}
          className={
            'flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11.5px] transition-colors duration-150 disabled:opacity-35 ' +
            (tool.active ? 'font-semibold text-accent' : 'text-ink')
          }
        >
          <span aria-hidden="true" className="text-[18px] leading-none">{tool.icon}</span>
          {tool.label}
        </button>
      ))}
    </div>
  );
}

/** 电脑上右下角的放大 / 缩小 / 看全图 */
export function ZoomControls({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  const style = 'size-11 border border-border bg-surface/90 p-0 backdrop-blur';
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5">
      <Button variant="ghost" aria-label="放大" className={style} onClick={() => onZoom(1.4)}>＋</Button>
      <Button variant="ghost" aria-label="缩小" className={style} onClick={() => onZoom(1 / 1.4)}>－</Button>
      <Button variant="ghost" aria-label="看全图" className={style} onClick={onFit}>⤢</Button>
    </div>
  );
}
