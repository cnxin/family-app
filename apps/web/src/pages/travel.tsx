import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { TravelPlan } from '@family/contracts';
import { travelDateRange, travelStatusLabel, useTravelPlans } from '../lib/queries';
import { PlanForm } from '../components/travel-forms';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

type Status = 'active' | 'completed' | 'cancelled' | 'archived';

const NO_PLANS: TravelPlan[] = [];

export function TravelPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('active');
  const [composing, setComposing] = useState(false);

  const list = useTravelPlans(status);
  const rows = list.data ?? NO_PLANS;

  // 日历和活动流给的是 /travel?planId=…，搬过来直接转到详情页
  const wanted = params.get('planId');
  if (wanted) {
    navigate(`/house/travel/${wanted}`, { replace: true });
  }

  return (
    <Page
      title="家庭出行"
      subtitle="行程、打包清单和家里的分工"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setComposing(true)}>
          + 新建行程
        </Button>
      }
      toolbar={
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active' as const, label: '计划中' },
            { value: 'completed' as const, label: '已完成' },
            { value: 'cancelled' as const, label: '已取消' },
            { value: 'archived' as const, label: '已归档' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {list.isPending ? (
          <ListSkeleton rows={3} />
        ) : list.isError ? (
          <EmptyState emoji="✈️" title="行程读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : rows.length === 0 ? (
          <EmptyState
            emoji="✈️"
            title={status === 'active' ? '还没有要出门的安排' : '这一类里没有行程'}
            hint="新建一个行程，出发前要带什么、谁负责，都记在一起"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((plan) => {
              const done = plan.counts.total
                ? Math.round((plan.counts.completed / plan.counts.total) * 100)
                : 0;
              return (
                <SoftLink
                  key={plan.id}
                  to={`/house/travel/${plan.id}`}
                  className="flex flex-col rounded-card border border-border px-3.5 py-3 transition-colors duration-150 hover:bg-muted"
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                      {plan.title}
                    </span>
                    <span
                      className={
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] ' +
                        (plan.archivedAt || plan.status === 'cancelled'
                          ? 'bg-muted text-ink-soft'
                          : plan.status === 'completed'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-warm-soft text-warm')
                      }
                    >
                      {travelStatusLabel(plan)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                    {travelDateRange(plan.startDate, plan.endDate)}
                    {plan.destination ? ` · ${plan.destination}` : ''}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${done}%` }} />
                    </div>
                    <span className="shrink-0 text-[12px] text-ink-soft">
                      {plan.counts.completed}/{plan.counts.total}
                    </span>
                  </div>
                </SoftLink>
              );
            })}
          </div>
        )}
      </Panel>

      {composing ? (
        <PlanForm
          editing={null}
          onSaved={(plan) => {
            setComposing(false);
            navigate(`/house/travel/${plan.id}`);
          }}
          onClose={() => setComposing(false)}
        />
      ) : null}
    </Page>
  );
}
