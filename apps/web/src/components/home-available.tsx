import type { ShelfModuleKey } from '@family/contracts';
import type { NavSegment } from '../lib/nav';
import { Button } from './ui';
import { SoftLink } from './soft-link';

const descriptions: Record<ShelfModuleKey, string> = {
  recipes: '收好家人爱吃的菜和做法', reminders: '重要的事，到时提醒', polls: '一起商量，投票做决定',
  inventory: '记住家里有什么、放在哪里', assets: '收好家电档案和维护安排', finance: '一起记账，照看家庭收支',
  points: '用积分记录付出，兑换小奖励', guests: '安排来访，照顾客人的偏好', media: '收好想看的片，一起挑一部',
  travel: '安排出行，出发前对一遍清单', memories: '留下值得记住的家庭时刻', knowledge: '家里的说明与经验，随时找得到',
  activity: '看看家里最近发生了什么', assistant: '用一句话请小管家帮忙',
};
export function HomeAvailable({ segment, hidden, manager, busy, onEnable }: {
  segment: NavSegment & { key: ShelfModuleKey }; hidden: boolean; manager: boolean; busy: boolean; onEnable: () => void;
}) {
  return (
    <div data-home-available={segment.key} className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-sm text-ink-soft">{segment.glyph}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{segment.label}{hidden ? <span className="ml-2 text-xs font-normal text-ink-soft">已收起</span> : null}</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-soft">{descriptions[segment.key]}</p>
      </div>
      {manager ? <Button variant="outline" className="min-h-11 shrink-0 px-3" disabled={busy} onClick={onEnable}>{hidden ? '重新开启' : '开启'}</Button>
        : <SoftLink to={segment.path!} className="flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm text-accent hover:bg-muted">去看看</SoftLink>}
    </div>
  );
}
