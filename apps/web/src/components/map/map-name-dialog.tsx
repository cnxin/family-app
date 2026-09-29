import { useState } from 'react';
import type { StorageLocation } from '@family/contracts';
import { Button, Dialog, Input } from '../ui';

// 画完一个矩形之后问名字：优先列出还没上图的同级位置（树里已经建好的「厨房」「吊柜」直接点），也可以输个新名字。

export const COMMON_ROOM_NAMES = ['客厅', '餐厅', '厨房', '主卧', '次卧', '书房', '卫生间', '阳台', '玄关', '储物间'];
const COMMON_CONTAINER_NAMES = ['衣柜', '鞋柜', '书柜', '电视柜', '吊柜', '冰箱', '抽屉柜', '储物箱'];

export function MapNameDialog({
  kind,
  unplaced,
  taken,
  onClose,
  onPickExisting,
  onCreate,
  busy,
}: {
  kind: 'room' | 'container';
  /** 同一层还没上图的位置 */
  unplaced: StorageLocation[];
  /** 同一层已经在用的名字（新名字不能重） */
  taken: string[];
  onClose: () => void;
  onPickExisting: (location: StorageLocation) => void;
  onCreate: (name: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const value = name.trim();
  const clash = value ? taken.includes(value) : false;
  const suggestions = (kind === 'room' ? COMMON_ROOM_NAMES : COMMON_CONTAINER_NAMES).filter(
    (one) => !taken.includes(one) && !unplaced.some((u) => u.name === one),
  );
  const noun = kind === 'room' ? '房间' : '柜子';
  return (
    <Dialog
      title={`这是哪个${noun}？`}
      onClose={onClose}
      maxWidth={420}
      footer={
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value && !clash && !busy) onCreate(value);
          }}
        >
          <Input autoFocus aria-label={`新${noun}名字`} value={name} maxLength={40} placeholder={`新${noun}的名字`} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" className="shrink-0" disabled={!value || clash || busy}>
            {busy ? '保存中…' : '好'}
          </Button>
        </form>
      }
    >
      {unplaced.length ? (
        <section className="mb-4">
          <h3 className="mb-2 text-[12px] font-medium text-ink-soft">已经建好、还没上图的{noun}</h3>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((one) => (
              <Button key={one.id} variant="ghost" className="min-h-11 border border-border" disabled={busy} onClick={() => onPickExisting(one)}>
                {one.name}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 text-[12px] font-medium text-ink-soft">常用名字</h3>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((one) => (
            <Button key={one} variant="ghost" className="min-h-11 border border-border" disabled={busy} onClick={() => onCreate(one)}>
              {one}
            </Button>
          ))}
        </div>
        {clash ? <p className="mt-2 text-[12.5px] text-danger">这一层已经有「{value}」了，点上面的按钮用它</p> : null}
      </section>
    </Dialog>
  );
}
