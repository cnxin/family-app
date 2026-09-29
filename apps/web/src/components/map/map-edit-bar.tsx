import { useState } from 'react';
import type { StorageLocation } from '@family/contracts';
import { Button, Input, Segmented } from '../ui';
import type { MapMode, MapTool } from './map-types';

// 编辑模式的工具条（管理员）。电脑：选 / 画房间 / 画柜子，选中的可以改名、转 90°、从图上拿掉；
// 手机：只改名和拖柜子，顶点编辑提示到电脑上做（§3 I2b）。

const TOOLS: { value: MapTool; label: string }[] = [
  { value: 'select', label: '选择' },
  { value: 'room', label: '画房间' },
  { value: 'container', label: '画柜子' },
];

const HINT: Record<MapTool, string> = {
  select: '点房间出顶点：拖顶点改形状，双击边加顶点，右键顶点删掉；选中的房间整块拖，柜子一起走',
  room: '在图上拖一个矩形画房间，画完再拖顶点修形状',
  container: '在房间里拖一个矩形画柜子',
};

export function MapEditBar({
  mode,
  tool,
  onTool,
  selected,
  showBackground,
  onToggleBackground,
  onRename,
  onRotate,
  onRemove,
}: {
  mode: MapMode;
  tool: MapTool;
  onTool: (tool: MapTool) => void;
  selected: StorageLocation | null;
  showBackground: boolean;
  onToggleBackground?: () => void;
  onRename: (name: string) => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const full = mode === 'edit-full';
  const small = 'min-h-10 border border-border px-3 text-[13px]';

  return (
    <div data-map-edit-bar className="mb-3 flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {full ? <Segmented value={tool} onChange={onTool} options={TOOLS} /> : null}
        {onToggleBackground ? (
          <Button variant="ghost" className={small} aria-pressed={showBackground} onClick={onToggleBackground}>
            {showBackground ? '隐藏截图' : '显示截图'}
          </Button>
        ) : null}
        {selected && !renaming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{selected.name}</span>
            <Button variant="ghost" className={small} onClick={() => { setName(selected.name); setRenaming(true); }}>改名</Button>
            {full && selected.kind !== 'room' && selected.mapShape?.type === 'rect' ? (
              <Button variant="ghost" className={small} onClick={onRotate}>转 90°</Button>
            ) : null}
            {full ? <Button variant="ghost" className={small + ' text-danger'} onClick={onRemove}>从图上拿掉</Button> : null}
          </span>
        ) : null}
      </div>
      {renaming && selected ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = name.trim();
            if (value && value !== selected.name) onRename(value);
            setRenaming(false);
          }}
        >
          <Input autoFocus aria-label="新名字" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" className="shrink-0">好</Button>
          <Button type="button" variant="ghost" className="shrink-0" onClick={() => setRenaming(false)}>取消</Button>
        </form>
      ) : null}
      <p className="text-[12.5px] text-ink-soft">
        {full ? HINT[tool] : '手机上只能改名和拖柜子；改房间形状、画新房间请在电脑上做'}
      </p>
    </div>
  );
}
