import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TravelChecklistItem } from '@family/contracts';
import {
  TRAVEL_CATEGORY_EMOJI,
  travelDateRange,
  travelKey,
  travelStatusLabel,
  useTravelItemAction,
  useTravelPlan,
  useTravelPlanAction,
} from '../lib/queries';
import { ApplyTemplateDialog } from '../components/travel-apply-template';
import { ItemForm, PlanForm } from '../components/travel-forms';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, EmptyState, Page, Panel } from '../components/ui';

type Ask =
  | { kind: 'plan'; action: 'complete' | 'reopen' | 'cancel' | 'archive' | 'restore' }
  | { kind: 'item'; action: 'skip' | 'archive'; item: TravelChecklistItem };

const PLAN_ASK: Record<string, { title: string; body: string; confirm: string }> = {
  complete: {
    title: '这趟就算完成了？',
    body: '完成之后清单就不能再改了，没发出去的相关提醒会一并取消。',
    confirm: '确认完成',
  },
  reopen: {
    title: '重新打开这个行程？',
    body: '行程会回到「计划中」，清单又能改了；之前取消掉的提醒不会自动回来。',
    confirm: '重新打开',
  },
  cancel: {
    title: '取消这个行程？',
    body: '行程和清单都留着，没发出去的相关提醒会取消。',
    confirm: '确认取消',
  },
  archive: {
    title: '归档这个行程？',
    body: '归档后它会从列表和日历里收起来，记录都保留；提醒会取消，恢复时不会自动回来。',
    confirm: '确认归档',
  },
  restore: {
    title: '恢复这个行程？',
    body: '它会回到对应状态的列表里。提醒不会自动恢复。',
    confirm: '恢复',
  },
};

export function TravelPlanPage() {
  const id = useParams<{ id: string }>().id;
  const query = useTravelPlan(id);
  const planAction = useTravelPlanAction();
  const itemAction = useTravelItemAction();
  const [editing, setEditing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<TravelChecklistItem | null>(null);
  const [applying, setApplying] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (query.isPending) {
    return (
      <Page title="出行" subtitle="正在读行程">
        <Panel className="p-3">
          <ListSkeleton rows={4} />
        </Panel>
      </Page>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Page title="出行" subtitle="这个行程可能已经没了">
        <Panel className="p-3">
          <EmptyState
            emoji="✈️"
            title="打不开这个行程"
            hint={
              <SoftLink to="/life/travel" className="text-accent hover:underline">
                回出行列表 →
              </SoftLink>
            }
          />
        </Panel>
      </Page>
    );
  }

  const plan = query.data;
  const archived = Boolean(plan.archivedAt);
  const planning = plan.status === 'planned' && !archived;
  const busy = planAction.isPending || itemAction.isPending;

  function runItem(item: TravelChecklistItem, action: 'complete' | 'restore' | 'skip' | 'archive') {
    itemAction.mutate(
      {
        planId: plan.id,
        itemId: item.id,
        action,
        expectedVersion: item.version,
        idempotencyKey: travelKey(`travel:item:${action}:${item.id}`),
      },
      {
        onSuccess: () => {
          setAsk(null);
          pushToast(
            action === 'complete'
              ? '打勾了'
              : action === 'restore'
                ? '放回待处理'
                : action === 'skip'
                  ? '这项跳过'
                  : '这项移除了',
          );
        },
      },
    );
  }

  function confirm() {
    if (!ask) return;
    if (ask.kind === 'item') return runItem(ask.item, ask.action);
    planAction.mutate(
      {
        id: plan.id,
        action: ask.action,
        expectedVersion: plan.version,
        idempotencyKey: travelKey(`travel:plan:${ask.action}:${plan.id}`),
      },
      {
        onSuccess: () => {
          setAsk(null);
          pushToast('行程状态更新了');
        },
      },
    );
  }

  return (
    <Page
      title={plan.title}
      subtitle={
        <>
          <SoftLink to="/life/travel" className="text-accent hover:underline">
            ← 家庭出行
          </SoftLink>
          {' · '}
          {travelDateRange(plan.startDate, plan.endDate)}
          {plan.destination ? ` · ${plan.destination}` : ''}
          {' · '}
          {travelStatusLabel(plan)}
        </>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          {planning ? (
            <SoftLink
              to={`/schedule/reminders?sourceModule=travel&sourceId=${plan.id}`}
              className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] text-ink-soft hover:bg-muted hover:text-ink"
            >
              设置提醒
            </SoftLink>
          ) : null}
          {plan.canManage && planning ? (
            <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={() => setEditing(true)}>
              编辑行程
            </Button>
          ) : null}
        </div>
      }
    >
      <Panel
        title={`出行清单 ${plan.counts.completed}/${plan.counts.total}`}
        right={
          plan.canEditChecklist ? (
            <div className="flex items-center gap-1">
              {/* 应用模板后端还要求是创建者或管理员，所以按 canManage 显示，别让人点了才吃 403 */}
              {plan.canManage ? (
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-[12px]"
                  onClick={() => setApplying(true)}
                >
                  套用模板
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="h-7 px-2 text-[12px]"
                onClick={() => setAddingItem(true)}
              >
                + 加一项
              </Button>
            </div>
          ) : null
        }
      >
        {plan.items.length === 0 ? (
          <EmptyState emoji="🧳" title="清单还是空的" hint="把要带的东西、出发前要办的事写进来" />
        ) : (
          plan.items.map((item, index) => (
            <div
              key={item.id}
              aria-label={item.title}
              className={
                'flex items-center gap-2.5 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')
              }
            >
              <Checkbox
                checked={item.status === 'completed'}
                disabled={!plan.canEditChecklist || busy}
                label={item.status === 'pending' ? `完成${item.title}` : `恢复${item.title}`}
                onChange={() => runItem(item, item.status === 'pending' ? 'complete' : 'restore')}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    'truncate text-[14px] ' +
                    (item.status === 'completed'
                      ? 'text-ink-soft line-through'
                      : item.status === 'skipped'
                        ? 'text-ink-soft'
                        : '')
                  }
                >
                  {TRAVEL_CATEGORY_EMOJI[item.category]} {item.title}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  {item.status === 'skipped' ? '（跳过）' : ''}
                </p>
                <p className="truncate text-[12px] text-ink-soft">
                  {item.assignedMember
                    ? `${item.assignedMember.avatarEmoji} ${item.assignedMember.name}`
                    : '没指定谁'}
                  {item.note ? ` · ${item.note}` : ''}
                </p>
              </div>
              {plan.canEditChecklist ? (
                <div className="flex shrink-0 items-center gap-1">
                  {item.status === 'pending' ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-[12px]"
                      aria-label={`跳过${item.title}`}
                      disabled={busy}
                      onClick={() => setAsk({ kind: 'item', action: 'skip', item })}
                    >
                      跳过
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-[12px]"
                    aria-label={`编辑${item.title}`}
                    onClick={() => setEditingItem(item)}
                  >
                    改
                  </Button>
                  {/* 移除只有管理员或行程创建者能做，后端也是这么判的 */}
                  {plan.canManage ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-[12px] text-danger"
                      aria-label={`移除${item.title}`}
                      disabled={busy}
                      onClick={() => setAsk({ kind: 'item', action: 'archive', item })}
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col gap-4 lg:w-[280px]">
        <Panel title="准备得怎么样" grow={false}>
          <div className="grid grid-cols-3 gap-2 px-3.5 py-3 text-center">
            <div>
              <p className="text-xl font-semibold text-warm">{plan.counts.pending}</p>
              <p className="text-[12px] text-ink-soft">待处理</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-accent">{plan.counts.completed}</p>
              <p className="text-[12px] text-ink-soft">已完成</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-ink-soft">{plan.counts.skipped}</p>
              <p className="text-[12px] text-ink-soft">已跳过</p>
            </div>
          </div>
          {plan.note ? (
            <p className="border-t border-border px-3.5 py-2.5 text-[13px] text-ink-soft">
              {plan.note}
            </p>
          ) : null}
          <p className="border-t border-border px-3.5 py-2.5 text-[12px] text-ink-soft">
            {plan.createdBy.name} 建的
          </p>
        </Panel>

        {plan.canManage ? (
          <Panel title="这趟的状态" grow={false}>
            <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
              {planning ? (
                <>
                  <Button
                    className="h-9 px-3 text-[13px]"
                    // 后端要求清单没有待处理项才能完成，这里先拦住，别让人点了才吃 409
                    disabled={busy || plan.counts.pending > 0}
                    onClick={() => setAsk({ kind: 'plan', action: 'complete' })}
                  >
                    完成行程
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-9 px-3 text-[13px] text-danger"
                    disabled={busy}
                    onClick={() => setAsk({ kind: 'plan', action: 'cancel' })}
                  >
                    取消行程
                  </Button>
                </>
              ) : null}
              {!planning && !archived ? (
                <Button
                  variant="outline"
                  className="h-9 px-3 text-[13px]"
                  disabled={busy}
                  onClick={() => setAsk({ kind: 'plan', action: 'reopen' })}
                >
                  重新打开
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className={'h-9 px-3 text-[13px] ' + (archived ? 'text-accent' : '')}
                disabled={busy}
                onClick={() => setAsk({ kind: 'plan', action: archived ? 'restore' : 'archive' })}
              >
                {archived ? '恢复行程' : '归档行程'}
              </Button>
            </div>
            {planning && plan.counts.pending > 0 ? (
              <p className="border-t border-border px-3.5 py-2.5 text-[12px] text-ink-soft">
                还有 {plan.counts.pending} 项没处理，先打勾或者跳过才能完成这趟。
              </p>
            ) : null}
          </Panel>
        ) : null}
      </aside>

      {applying ? <ApplyTemplateDialog plan={plan} onClose={() => setApplying(false)} /> : null}

      {editing ? (
        <PlanForm editing={plan} onSaved={() => setEditing(false)} onClose={() => setEditing(false)} />
      ) : null}

      {addingItem || editingItem ? (
        <ItemForm
          plan={plan}
          editing={editingItem}
          onClose={() => {
            setAddingItem(false);
            setEditingItem(null);
          }}
        />
      ) : null}

      {ask ? (
        <Dialog
          title={ask.kind === 'plan' ? PLAN_ASK[ask.action].title : ask.action === 'skip' ? '跳过这项？' : '把这项移掉？'}
          onClose={() => setAsk(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsk(null)}>
                取消
              </Button>
              <Button className="flex-1" disabled={busy} onClick={confirm}>
                {ask.kind === 'plan'
                  ? PLAN_ASK[ask.action].confirm
                  : ask.action === 'skip'
                    ? '确认跳过'
                    : '确认移除'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {ask.kind === 'plan'
              ? PLAN_ASK[ask.action].body
              : ask.action === 'skip'
                ? `「${ask.item.title}」会留在清单里，标成已跳过。`
                : `「${ask.item.title}」会从清单里收起来，历史记录还留着。`}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
