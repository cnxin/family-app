import { useMemo } from 'react';
import type { MapPolygon } from '@family/contracts';
import { Button, Input } from '../ui';
import { MapCanvas } from './map-canvas';
import { COMMON_ROOM_NAMES } from './map-name-dialog';
import type { MapItem } from './map-types';

// 导入向导第 3 步：逐个高亮房间起名字。识别出来的只是草稿——多了能删、碎了能并进相邻房间，
// 不用回到上一步（item-location-plan §3 I2a）。

export interface RoomDraft {
  id: string;
  name: string;
  shape: MapPolygon;
}

export function ImportName({
  viewBox,
  background,
  drafts,
  current,
  onCurrent,
  onRename,
  onRemove,
  existingNames,
  mergeTargets,
  onMerge,
}: {
  viewBox: { w: number; h: number };
  background: string;
  drafts: RoomDraft[];
  current: number;
  onCurrent: (index: number) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** 位置树里已经有的房间名（起同名就直接用那个房间，不另建） */
  existingNames: string[];
  /** 能并进去的相邻房间（识别那一步才有） */
  mergeTargets?: RoomDraft[];
  onMerge?: (targetId: string) => void;
}) {
  const draft = drafts[current];
  const items = useMemo<MapItem[]>(
    () => drafts.map((one, index) => ({ id: one.id, parentId: null, kind: 'room', name: one.name || `房间 ${index + 1}`, shape: one.shape })),
    [drafts],
  );
  const used = new Set(drafts.filter((one) => one.id !== draft?.id).map((one) => one.name.trim()).filter(Boolean));
  const suggestions = [...new Set([...existingNames, ...COMMON_ROOM_NAMES])].filter((one) => !used.has(one));
  const duplicate = draft && draft.name.trim() && used.has(draft.name.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="relative h-[46vh] min-h-[300px] overflow-hidden rounded-card border border-border bg-muted lg:h-auto lg:flex-1">
        <MapCanvas
          label="起名字的房间"
          viewBox={viewBox}
          items={items}
          background={background}
          backgroundOpacity={0.35}
          mode="view"
          selectedId={draft?.id ?? null}
          onSelect={(id) => {
            const index = drafts.findIndex((one) => one.id === id);
            if (index >= 0) onCurrent(index);
          }}
        />
      </div>
      <div className="flex flex-col gap-3 lg:w-[340px] lg:flex-none">
        {draft ? (
          <>
            <p className="text-[13px] text-ink-soft">
              第 {current + 1} / {drafts.length} 个房间（图上描边的那块）
            </p>
            <Input
              autoFocus
              aria-label="房间名字"
              value={draft.name}
              maxLength={40}
              placeholder="这是哪个房间？"
              onChange={(event) => onRename(draft.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && current < drafts.length - 1) onCurrent(current + 1);
              }}
            />
            {duplicate ? <p className="text-[12.5px] text-danger">「{draft.name.trim()}」已经给别的房间用了</p> : null}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((one) => (
                <Button
                  key={one}
                  variant="ghost"
                  className="min-h-11 border border-border"
                  onClick={() => {
                    onRename(draft.id, one);
                    if (current < drafts.length - 1) onCurrent(current + 1);
                  }}
                >
                  {one}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button variant="ghost" className="min-h-11 border border-border text-danger" onClick={() => onRemove(draft.id)}>
                这块不是房间，删掉
              </Button>
              {mergeTargets?.map((target) => (
                <Button key={target.id} variant="ghost" className="min-h-11 border border-border" onClick={() => onMerge?.(target.id)}>
                  并进「{target.name || `房间 ${drafts.indexOf(target) + 1}`}」
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="min-h-11 flex-1 border border-border" disabled={current === 0} onClick={() => onCurrent(current - 1)}>
                上一个
              </Button>
              <Button variant="ghost" className="min-h-11 flex-1 border border-border" disabled={current >= drafts.length - 1} onClick={() => onCurrent(current + 1)}>
                下一个
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-soft">一个房间都没有了，回上一步画几个。</p>
        )}
      </div>
    </div>
  );
}
