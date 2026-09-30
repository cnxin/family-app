import { useState } from 'react';
import { Button, Dialog, Input } from '../../ui';
import { COMMON_ROOM_NAMES } from '../map-name-dialog';

// 拆分房间的确认框（地图编辑器 v2 §2.3、拍板 2）：给切出来的那块起名，同时写清后果——拆了不能撤销。

export function SplitDialog({
  roomName,
  consequence,
  taken,
  busy,
  onClose,
  onConfirm,
}: {
  roomName: string;
  /** 哪些柜子跟过去、哪些东西留下 */
  consequence: string;
  /** 已经有的房间名（新名字不能重） */
  taken: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const value = name.trim();
  const clash = value ? taken.includes(value) : false;
  return (
    <Dialog
      title={`把「${roomName}」拆成两间`}
      onClose={onClose}
      maxWidth={440}
      footer={
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value && !clash && !busy) onConfirm(value);
          }}
        >
          <Input autoFocus aria-label="新房间名字" value={name} maxLength={40} placeholder="高亮那块叫什么" onChange={(event) => setName(event.target.value)} />
          {clash ? <p className="text-[12.5px] text-danger">已经有「{value}」了，换个名字</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={!value || clash || busy}>{busy ? '拆分中…' : '拆分'}</Button>
          </div>
        </form>
      }
    >
      <p className="mb-3 text-[14px] leading-relaxed text-ink-soft">{consequence}</p>
      <div className="flex flex-wrap gap-2">
        {COMMON_ROOM_NAMES.filter((one) => !taken.includes(one)).map((one) => (
          <Button key={one} variant="ghost" aria-pressed={value === one} className={'min-h-11 border ' + (value === one ? 'border-accent bg-accent-soft' : 'border-border')} onClick={() => setName(one)}>
            {one}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
