import type { MemberProfile, TaskOccurrence } from '@family/contracts';
import { useUpdateOccurrence } from '../lib/queries';
import { Button } from './ui';

/** 确认认领时给一下轻触感；桌面没有振动器就什么都不发生。 */
function confirmHaptic() {
  navigator.vibrate?.(10);
}

/** 未认领是按钮，认领给自己之后变成「我的」。别人的任务仍显示名字。 */
export function TaskAssignee({ item, member }: { item: TaskOccurrence; member: MemberProfile }) {
  const update = useUpdateOccurrence();
  if (item.assigneeId === member.id) {
    return (
      <span
        data-task-owner="mine"
        className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
      >
        我的
      </span>
    );
  }
  if (!item.assigneeId && item.status === 'pending') {
    return (
      <Button
        type="button"
        variant="ghost"
        disabled={update.isPending}
        className="h-11 min-h-11 min-w-11 shrink-0 rounded-full bg-warm-soft px-3 text-[13px] text-warm hover:bg-warm-soft"
        onClick={() => {
          confirmHaptic();
          update.mutate({
            taskId: item.taskId,
            dueDate: item.dueDate,
            body: { assigneeId: member.id },
            assignee: member,
          });
        }}
      >
        认领
      </Button>
    );
  }
  if (!item.assignee) return null;
  return (
    <span className="shrink-0 text-xs text-ink-soft">
      {item.assignee.avatarEmoji} {item.assignee.name}
    </span>
  );
}
