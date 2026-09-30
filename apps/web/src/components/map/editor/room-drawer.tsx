import { useState } from 'react';
import type { StorageLocation } from '@family/contracts';

// 编辑态左上角的房间抽屉（地图编辑器 v2 §1.4）：默认收起，展开是一个窄列表，点一项 = 选中并对准那间房。
// 展开 / 收起记在本机（只是个方便，读写失败就当没记）。

const KEY = 'family-app.map-editor.rooms-open';

function remembered() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function RoomDrawer({
  rooms,
  locations,
  selectedId,
  onPick,
  background,
  collapsed = false,
}: {
  /** 家具库面板开着时收起列表（两块都在左边，别叠在一起） */
  collapsed?: boolean;
  rooms: StorageLocation[];
  locations: StorageLocation[];
  selectedId: string | null;
  onPick: (id: string) => void;
  /** 有截图时给一个「描图参考」开关 */
  background?: { shown: boolean; toggle: () => void };
}) {
  const [open, setOpen] = useState(remembered);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? '0' : '1');
    } catch {
      /* 存不了就算了 */
    }
  };
  const containers = (id: string) => locations.filter((one) => one.parentId === id && !one.archivedAt && one.kind !== 'slot').length;
  return (
    <div className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-120px)] w-[240px] flex-col items-start gap-2 lg:left-4 lg:top-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface/88 px-3.5 text-[14px] shadow-md backdrop-blur-xl"
      >
        <span aria-hidden="true">☰</span>房间
        <span className="text-ink-soft">{rooms.length}</span>
        <span aria-hidden="true" className={'text-ink-soft transition-transform duration-150 ' + (open ? 'rotate-90' : '')}>▸</span>
      </button>
      {open && !collapsed ? (
        <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface/92 shadow-lg backdrop-blur-xl motion-safe:animate-[float-in_150ms_cubic-bezier(0,0,0.2,1)]">
          <ul aria-label="房间" className="min-h-0 overflow-y-auto p-1">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => onPick(room.id)}
                  aria-pressed={room.id === selectedId}
                  className={
                    'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13.5px] transition-colors duration-150 hover:bg-muted ' +
                    (room.id === selectedId ? 'bg-accent-soft' : '') +
                    (room.mapShape ? '' : ' text-ink-soft')
                  }
                >
                  <span className="truncate">{room.name}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-soft">{room.mapShape ? `${containers(room.id)} 个柜子` : '没上图'}</span>
                </button>
              </li>
            ))}
          </ul>
          {background ? (
            <label className="flex min-h-10 items-center gap-2 border-t border-border px-3 text-[12.5px] text-ink-soft">
              <input type="checkbox" checked={background.shown} onChange={background.toggle} className="size-4 accent-[var(--color-accent)]" />
              描图参考：显示导入的截图
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
