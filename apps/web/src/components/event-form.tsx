import { useState } from 'react';
import type { CalendarEntry } from '@family/contracts';
import { useUpsertCalendarEvent } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

function timeValue(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 本地时间拼成 ISO：后端存的是时刻，家里人填的是「几点」，转换放在这一层。 */
function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function EventForm({
  date,
  editing,
  onClose,
}: {
  date: string;
  editing: CalendarEntry | null;
  onClose: () => void;
}) {
  const upsert = useUpsertCalendarEvent();
  const [day, setDay] = useState(editing?.date ?? date);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [note, setNote] = useState(editing?.summary ?? '');
  // 大多数家庭事件是「这天有这么回事」，不需要几点到几点，所以默认全天
  const [timed, setTimed] = useState(Boolean(editing?.startsAt));
  const [startTime, setStartTime] = useState(timeValue(editing?.startsAt ?? null) || '18:00');
  const [endTime, setEndTime] = useState(timeValue(editing?.endsAt ?? null) || '20:00');

  const valid = Boolean(title.trim()) && Boolean(day) && (!timed || Boolean(startTime));

  const submit = () => {
    if (!valid || upsert.isPending) return;
    upsert.mutate(
      {
        id: editing?.sourceId,
        body: {
          date: day,
          title: title.trim(),
          note: note.trim() || null,
          startsAt: timed ? localDateTime(day, startTime) : null,
          endsAt: timed && endTime ? localDateTime(day, endTime) : null,
        },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '事件已更新' : `已添加「${title.trim()}」`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      title={editing ? '编辑事件' : '添加家庭事件'}
      onClose={onClose}
      footer={
        <Button className="w-full" disabled={!valid || upsert.isPending} onClick={submit}>
          {upsert.isPending ? '保存中…' : '保存'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-soft">名称</span>
          <Input
            autoFocus
            value={title}
            placeholder="比如：奶奶生日、家长会"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-soft">日期</span>
          <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>

        <button
          type="button"
          role="checkbox"
          aria-checked={timed}
          onClick={() => setTimed((value) => !value)}
          className={
            'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ' +
            (timed ? 'border-accent bg-accent-soft' : 'border-border hover:bg-muted')
          }
        >
          <span className={timed ? 'text-accent' : 'text-ink-soft'}>{timed ? '☑' : '☐'}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">指定时间</span>
            <span className="mt-0.5 block text-[12px] text-ink-soft">
              不勾就是全天，日历上按全天排
            </span>
          </span>
        </button>

        {timed ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-soft">开始</span>
              <Input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-soft">结束（选填）</span>
              <Input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-soft">备注（选填）</span>
          <textarea
            value={note}
            rows={3}
            placeholder="要带什么、几点出门…"
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </label>
      </div>
    </Dialog>
  );
}
