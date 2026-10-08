import { useState } from 'react';
import type { TaskOccurrence, TaskRecurrence } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { useArchiveTask, useMembers, useUpdateOccurrence, useUpdateTask } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input, selectClass } from './ui';

const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  once: '只做一次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

function recurrenceText(item: TaskOccurrence) {
  const { recurrence, repeatInterval } = item.task;
  if (recurrence === 'once' || repeatInterval <= 1) return RECURRENCE_LABELS[recurrence];
  const unit = { daily: '天', weekly: '周', monthly: '个月' }[recurrence];
  return `每 ${repeatInterval} ${unit}`;
}

const label = 'mb-1.5 block text-[13px] font-medium text-ink-soft';
type Mode = 'view' | 'edit' | 'delete';

/** 任务详情：看清是什么、哪天、谁来做；能管这个任务的人可以改或删。 */
export function TaskDetail({ item, onClose }: { item: TaskOccurrence; onClose: () => void }) {
  const { session } = useAuth();
  const manager = session?.member.role === 'owner' || session?.member.role === 'admin';
  const members = useMembers();
  const updateTask = useUpdateTask();
  const updateOccurrence = useUpdateOccurrence();
  const archive = useArchiveTask();
  const [mode, setMode] = useState<Mode>('view');
  const [title, setTitle] = useState(item.task.title);
  const [startsOn, setStartsOn] = useState(item.task.startsOn);
  const [assigneeId, setAssigneeId] = useState(item.assigneeId ?? '');
  const [points, setPoints] = useState(String(item.task.rewardPoints));
  const [message, setMessage] = useState<string | null>(null);
  const repeating = item.task.recurrence !== 'once';
  const busy = updateTask.isPending || updateOccurrence.isPending || archive.isPending;

  async function save() {
    const trimmed = title.trim();
    const rewardPoints = Number(points);
    if (!trimmed) return setMessage('任务名称不能空着');
    if (manager && (!Number.isInteger(rewardPoints) || rewardPoints < 0 || rewardPoints > 10000)) {
      return setMessage('积分要是 0 到 10000 的整数');
    }
    setMessage(null);
    const nextAssignee = assigneeId || null;
    try {
      await updateTask.mutateAsync({
        id: item.taskId,
        body: {
          title: trimmed,
          startsOn,
          defaultAssigneeId: nextAssignee,
          ...(manager ? { rewardPoints } : {}),
        },
      });
      // 默认指派人只会带走「还是原默认人」的待办；这一次若已被别人认领，单独改过去。
      const sameDay = startsOn === item.task.startsOn;
      if (sameDay && item.status === 'pending' && item.canUpdate && item.assigneeId !== nextAssignee) {
        await updateOccurrence.mutateAsync({
          taskId: item.taskId,
          dueDate: item.dueDate,
          body: { assigneeId: nextAssignee },
        });
      }
      pushToast('任务改好了', undefined, 'success');
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '没改成功');
    }
  }

  async function removeAll() {
    try {
      await archive.mutateAsync(item.taskId);
      pushToast(repeating ? `「${item.task.title}」以后都不会再出现` : `「${item.task.title}」已删除`, undefined, 'success');
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '没删成功');
    }
  }

  async function skipThisOne() {
    try {
      await updateOccurrence.mutateAsync({
        taskId: item.taskId,
        dueDate: item.dueDate,
        body: { status: 'skipped' },
      });
      pushToast(`${item.dueDate} 这一次不做了`, undefined, 'success');
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '没删成功');
    }
  }

  const footer =
    mode === 'edit' ? (
      <div className="flex flex-col gap-2">
        {message ? <p role="alert" className="text-[13px] text-danger">{message}</p> : null}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setMode('view')}>
            取消
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    ) : mode === 'delete' ? (
      <div className="flex flex-col gap-2">
        {message ? <p role="alert" className="text-[13px] text-danger">{message}</p> : null}
        {repeating ? (
          <>
            <Button
              variant="outline"
              disabled={busy || !item.canUpdate || item.status !== 'pending'}
              onClick={() => void skipThisOne()}
            >
              只删这次（{item.dueDate}）
            </Button>
            <Button className="bg-danger text-on-danger" disabled={busy} onClick={() => void removeAll()}>
              全部删掉，以后都不出现
            </Button>
          </>
        ) : (
          <Button className="bg-danger text-on-danger" disabled={busy} onClick={() => void removeAll()}>
            删除这个任务
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => setMode('view')}>
          不删了
        </Button>
      </div>
    ) : item.canManageTask ? (
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setMode('delete')}>
          删除
        </Button>
        <Button className="flex-1" onClick={() => setMode('edit')}>
          编辑
        </Button>
      </div>
    ) : undefined;

  return (
    <Dialog
      title={mode === 'edit' ? '编辑任务' : mode === 'delete' ? '删除这个任务？' : item.task.title}
      onClose={onClose}
      maxWidth={420}
      footer={footer}
    >
      {mode === 'edit' ? (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={label}>任务名称</span>
            <Input autoFocus value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block">
            <span className={label}>{repeating ? '从哪天开始' : '哪天做'}</span>
            <Input type="date" value={startsOn} onChange={(event) => event.target.value && setStartsOn(event.target.value)} />
          </label>
          <label className="block">
            <span className={label}>谁来做</span>
            <select
              className={`${selectClass} w-full`}
              value={assigneeId}
              aria-label="谁来做"
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">先不指派，谁有空谁认领</option>
              {(members.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.avatarEmoji} {member.name}
                </option>
              ))}
            </select>
          </label>
          {manager ? (
            <label className="block">
              <span className={label}>做完给多少积分</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                value={points}
                onChange={(event) => setPoints(event.target.value)}
              />
            </label>
          ) : null}
          {repeating && startsOn !== item.task.startsOn ? (
            <p className="text-[12px] text-ink-soft">改开始日期后，还没做的那几次会按新日期重新排。</p>
          ) : null}
        </div>
      ) : mode === 'delete' ? (
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {repeating
            ? `「${item.task.title}」是${recurrenceText(item)}的任务。只删这次，以后照常；全部删掉，以后都不再出现，已经做完的记录会留着。`
            : `「${item.task.title}」删掉以后不再出现在任务和日历里。`}
        </p>
      ) : (
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-[14px]" data-task-detail>
          <dt className="text-ink-soft">哪天</dt>
          <dd>{item.dueDate}</dd>
          <dt className="text-ink-soft">重复</dt>
          <dd>{recurrenceText(item)}</dd>
          <dt className="text-ink-soft">谁来做</dt>
          <dd>{item.assignee ? `${item.assignee.avatarEmoji} ${item.assignee.name}` : '还没人认领'}</dd>
          {item.task.rewardPoints > 0 ? (
            <>
              <dt className="text-ink-soft">积分</dt>
              <dd>做完 +{item.task.rewardPoints}</dd>
            </>
          ) : null}
          {item.task.note ? (
            <>
              <dt className="text-ink-soft">备注</dt>
              <dd className="whitespace-pre-wrap">{item.task.note}</dd>
            </>
          ) : null}
          {!item.canManageTask ? (
            <p className="col-span-2 mt-1 text-[12px] text-ink-soft">这个任务是别人建的，只有建的人和管理员能改。</p>
          ) : null}
        </dl>
      )}
    </Dialog>
  );
}
