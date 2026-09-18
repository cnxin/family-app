import { useState } from 'react';
import type { HouseholdActivity } from '@family/contracts';
import {
  ACTIVITY_MODULE_EMOJI,
  activityDayLabel,
  activityTimeLabel,
  useActivities,
} from '../lib/queries';
import { toNewRoute } from '../lib/routes';
import { legacyUrl } from '../lib/nav';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { EmptyState, Page, Panel, Segmented } from '../components/ui';

type Scope = 'all' | 'members' | 'menus';

const NO_ACTIVITIES: HouseholdActivity[] = [];

/** 一天一组，组内保持后端给的时间倒序。 */
function groupByDay(rows: HouseholdActivity[]) {
  const groups: { key: string; title: string; items: HouseholdActivity[] }[] = [];
  for (const activity of rows) {
    const date = new Date(activity.occurredAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(activity);
    else groups.push({ key, title: activityDayLabel(activity.occurredAt), items: [activity] });
  }
  return groups;
}

function Row({ activity }: { activity: HouseholdActivity }) {
  // 后端写的 targetPath 还是旧的一层路径；搬过来的分段用 toNewRoute 转，
  // 没搬的就给一个旧版链接，别留个点不动的行
  const target = toNewRoute(activity.targetPath);
  const legacy = !target && activity.targetPath ? legacyUrl(activity.targetPath) : null;

  const body = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[15px]">
        {ACTIVITY_MODULE_EMOJI[activity.module]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px]">{activity.summary}</p>
        {activity.detail ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-soft">{activity.detail}</p>
        ) : null}
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {activity.actor.avatarEmoji} {activity.actor.name} · {activityTimeLabel(activity.occurredAt)}
        </p>
      </div>
    </>
  );

  const className = 'flex items-start gap-2.5 px-3.5 py-2.5';

  if (target) {
    return (
      <SoftLink to={target} className={`${className} hover:bg-muted`}>
        {body}
      </SoftLink>
    );
  }
  if (legacy) {
    return (
      <a href={legacy} target="_blank" rel="noopener noreferrer" className={`${className} hover:bg-muted`}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

export function ActivityPage() {
  const [scope, setScope] = useState<Scope>('all');
  const list = useActivities(scope);
  const groups = groupByDay(list.data ?? NO_ACTIVITIES);

  return (
    <Page
      title="家庭动态"
      subtitle="家里最近都发生了什么"
      toolbar={
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all' as const, label: '全部' },
            { value: 'members' as const, label: '成员' },
            { value: 'menus' as const, label: '菜单' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {list.isPending ? (
          <ListSkeleton rows={5} />
        ) : list.isError ? (
          <EmptyState emoji="🕘" title="动态读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : groups.length === 0 ? (
          <EmptyState emoji="🕘" title="还没有动态" hint="家里人做点什么，这儿就会有记录" />
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-1.5 px-1 text-[12px] font-medium text-ink-soft">{group.title}</h2>
                <div className="overflow-hidden rounded-card border border-border">
                  {group.items.map((activity, index) => (
                    <div
                      key={activity.id}
                      className={index ? 'border-t border-border' : ''}
                    >
                      <Row activity={activity} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
