import type { HouseholdActivity, HouseholdReminder, ShoppingItem } from '@family/contracts';
import { activityTimeLabel } from '../lib/queries';
import { toNewRoute } from '../lib/routes';
import { Panel } from './ui';
import { SoftLink } from './soft-link';

function clock(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function More({ to, children }: { to: string; children: string }) {
  return (
    <SoftLink to={to} className="shrink-0 text-[13px] text-accent hover:underline">
      {children}
    </SoftLink>
  );
}

const row = 'flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0';

/** 今天还没到点的提醒，按时间排。 */
export function TodayReminders({ items }: { items: HouseholdReminder[] }) {
  return (
    <Panel
      grow={false}
      title={`待提醒${items.length ? ` · ${items.length}` : ''}`}
      right={<More to="/schedule/reminders">全部</More>}
    >
      {items.length ? (
        items.slice(0, 5).map((one) => (
          <div key={one.id} className={row}>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-medium tabular-nums">
              {clock(one.remindAt)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {one.source?.title ?? '原事项已不可用'}
            </span>
          </div>
        ))
      ) : (
        <p className="px-3.5 py-4 text-[13px] text-ink-soft">今天没有要提醒的事</p>
      )}
    </Panel>
  );
}

export function TodayShopping({ items }: { items: ShoppingItem[] }) {
  return (
    <Panel
      grow={false}
      title={`要买的${items.length ? ` · ${items.length}` : ''}`}
      right={<More to="/house/shopping">购物清单</More>}
    >
      {items.length ? (
        items.slice(0, 6).map((item) => (
          <div key={item.id} className={row}>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {item.ingredient?.name ?? item.customName ?? '未知'}
            </span>
            {item.totalQty ? (
              <span className="shrink-0 text-[12px] text-ink-soft">
                {Number(item.totalQty)} {item.unit ?? ''}
              </span>
            ) : null}
          </div>
        ))
      ) : (
        <p className="px-3.5 py-4 text-[13px] text-ink-soft">今天没有要买的</p>
      )}
    </Panel>
  );
}

/**
 * 「家里最近」——首页原来全是待办清单，看着像个任务系统。
 * 这一块放的是家里人刚刚干了什么，是这页唯一一块「不需要你做任何事」的内容。
 */
export function TodayActivity({ items }: { items: HouseholdActivity[] }) {
  return (
    <Panel title="家里最近" right={<More to="/life/activity">全部动态</More>}>
      {items.length ? (
        items.slice(0, 8).map((one) => {
          const target = toNewRoute(one.targetPath);
          const body = (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[14px]">
                {one.actor.avatarEmoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{one.summary}</span>
                <span className="block text-[11.5px] text-ink-soft">
                  {one.actor.name} · {activityTimeLabel(one.occurredAt)}
                </span>
              </span>
            </>
          );
          return target ? (
            <SoftLink key={one.id} to={target} className={`${row} hover:bg-muted`}>
              {body}
            </SoftLink>
          ) : (
            <div key={one.id} className={row}>
              {body}
            </div>
          );
        })
      ) : (
        <p className="px-3.5 py-4 text-[13px] text-ink-soft">还没有动静</p>
      )}
    </Panel>
  );
}
