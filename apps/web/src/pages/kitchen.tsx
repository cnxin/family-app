import { useState } from 'react';
import type { MealType, MenuEvent, MenuItem, MenuItemStatus } from '@family/contracts';
import { MEAL_TYPES } from '@family/contracts';
import { Link } from 'react-router-dom';
import {
  MEAL_LABELS,
  defaultMealType,
  shiftDays,
  todayISO,
  useAssignChef,
  useCompleteMenu,
  useMembers,
  useMenu,
  useMenuDateCounts,
  useMenuEvents,
  useRecipe,
  useUpdateMenuItem,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { Button, Card, Input, SectionTitle } from '../components/ui';

const STATUS_LABEL: Record<MenuItemStatus, string> = {
  pending: '待接',
  accepted: '已接',
  cooking: '在做',
  done: '做好了',
  rejected: '已划掉',
};

const NEXT_STEP: Partial<Record<MenuItemStatus, { to: MenuItemStatus; label: string }>> = {
  pending: { to: 'accepted', label: '接单' },
  accepted: { to: 'cooking', label: '开始做' },
  cooking: { to: 'done', label: '做好了' },
};

const EVENT_LABEL: Record<MenuEvent['type'], string> = {
  item_ordered: '点了',
  item_status_changed: '把状态改成',
  item_assigned: '把菜分给',
  item_note_changed: '改了备注',
  meal_chef_assigned: '指定主厨',
  menu_completed: '结束了这一餐',
};

function StatusChip({ status }: { status: MenuItemStatus }) {
  const tone =
    status === 'done'
      ? 'bg-accent-soft text-accent'
      : status === 'cooking'
        ? 'bg-warm-soft text-warm'
        : 'bg-muted text-ink-soft';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const selectClass =
  'h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink ' +
  'transition-colors duration-150 hover:border-ink-soft/40 focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

/** 展开后的一道菜：备注、认领、做法与步骤。 */
function ItemDetail({
  item,
  locked,
  date,
  meal,
}: {
  item: MenuItem;
  locked: boolean;
  date: string;
  meal: MealType;
}) {
  const members = useMembers();
  const recipe = useRecipe(item.dishId);
  const update = useUpdateMenuItem(date, meal);
  const [note, setNote] = useState(item.note ?? '');
  const dirty = note.trim() !== (item.note ?? '');

  const variants = (recipe.data?.recipeVariants ?? []).filter((one) => !one.isArchived);
  const current =
    variants.find((one) => one.id === item.recipeVariantId) ??
    variants.find((one) => one.isDefault) ??
    null;

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-4 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">备注</span>
          <Input
            value={note}
            disabled={locked}
            placeholder="少放辣、多加醋…"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button
          className="h-10 shrink-0 px-4"
          disabled={!dirty || locked || update.isPending}
          onClick={() => update.mutate({ id: item.id, body: { note: note.trim() } })}
        >
          存备注
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">谁来做这道</span>
          <select
            className={selectClass}
            disabled={locked || update.isPending}
            value={item.assignedToId ?? ''}
            onChange={(event) =>
              update.mutate({
                id: item.id,
                body: { assignedToId: event.target.value || null },
              })
            }
          >
            <option value="">还没认领</option>
            {(members.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[160px] flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-soft">按哪个做法</span>
          <select
            className={selectClass}
            disabled={locked || update.isPending || variants.length === 0}
            value={current?.id ?? ''}
            onChange={(event) =>
              update.mutate({ id: item.id, body: { recipeVariantId: event.target.value } })
            }
          >
            {variants.length === 0 ? <option value="">这道菜还没有做法</option> : null}
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
                {variant.isDefault ? '（家庭默认）' : ''}
                {variant.author ? ` · ${variant.author.name}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {recipe.isPending ? (
        <p className="text-[13px] text-ink-soft">读取菜谱…</p>
      ) : current ? (
        <div className="flex flex-col gap-3">
          {current.ingredients.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-soft">食材</p>
              <p className="text-[13.5px] leading-relaxed">
                {current.ingredients
                  .map((one) => `${one.ingredient.name} ${one.quantity}${one.unit}`)
                  .join(' · ')}
              </p>
            </div>
          ) : null}
          {current.steps.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-ink-soft">
                做法{current.estMinutes ? ` · 约 ${current.estMinutes} 分钟` : ''}
              </p>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">
                {current.steps
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((step) => (
                    <li key={step.id}>{step.text}</li>
                  ))}
              </ol>
            </div>
          ) : (
            <p className="text-[13px] text-ink-soft">这个做法还没写步骤</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EventLine({ event }: { event: MenuEvent }) {
  const time = new Date(event.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const target = event.menuItem?.dish.name;
  const detail =
    event.type === 'item_status_changed'
      ? STATUS_LABEL[(event.toValue ?? 'pending') as MenuItemStatus]
      : event.type === 'item_assigned'
        ? (event.recipient?.name ?? '没人')
        : event.type === 'meal_chef_assigned'
          ? (event.toValue ?? '')
          : '';
  return (
    <div className="flex items-baseline gap-2 px-4 py-2 text-[13px]">
      <span className="shrink-0 font-mono text-[11px] text-ink-soft">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{event.actor.name}</span> {EVENT_LABEL[event.type]}
        {target ? ` ${target}` : ''}
        {detail ? ` ${detail}` : ''}
        {event.reason ? `（${event.reason}）` : ''}
      </span>
    </div>
  );
}

export function KitchenPage() {
  const { session } = useAuth();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(defaultMealType);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const menu = useMenu(date, meal);
  const counts = useMenuDateCounts(shiftDays(date, -1), shiftDays(date, 1));
  const updateItem = useUpdateMenuItem(date, meal);
  const assignChef = useAssignChef(date, meal);
  const completeMenu = useCompleteMenu(date, meal);
  const events = useMenuEvents(menu.data?.id, showLog);

  const items = menu.data?.items ?? [];
  const live = items.filter((item) => item.status !== 'rejected');
  const undone = live.filter((item) => item.status !== 'done').length;
  const locked = menu.data?.status === 'done';
  const iAmChef = menu.data?.chefId === session?.member.id;
  const mine = live.filter((item) => item.assignedToId === session?.member.id).length;
  const dayCount = (value: string) => counts.data?.find((row) => row.date === value)?.count ?? 0;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-32 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">厨房</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {date === today ? '今天' : date.slice(5)} · {MEAL_LABELS[meal]}
            {locked ? ' · 已结束' : undone > 0 ? ` · 还有 ${undone} 道没做好` : ' · 都做好了'}
            {mine > 0 ? ` · 我要做 ${mine} 道` : ''}
          </p>
        </div>
        <Link
          to="/order"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-accent transition-colors duration-150 hover:bg-muted"
        >
          ← 回去点菜
        </Link>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-9 w-9 px-0" aria-label="前一天"
          onClick={() => setDate(shiftDays(date, -1))}>‹</Button>
        <input
          type="date"
          aria-label="选择日期"
          value={date}
          onChange={(event) => event.target.value && setDate(event.target.value)}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <Button variant="outline" className="h-9 w-9 px-0" aria-label="后一天"
          onClick={() => setDate(shiftDays(date, 1))}>›</Button>
        {date === today ? null : (
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setDate(today)}>
            回今天
          </Button>
        )}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {MEAL_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={meal === value}
              onClick={() => setMeal(value)}
              className={
                'rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                (meal === value ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-soft hover:text-ink')
              }
            >
              {MEAL_LABELS[value]}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-soft">
          昨天 {dayCount(shiftDays(date, -1))} · 明天 {dayCount(shiftDays(date, 1))}
        </span>
      </div>

      <section className="mt-5">
        <SectionTitle
          right={
            menu.data && !locked ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-soft">
                  {menu.data.chef ? `${menu.data.chef.name}掌勺` : '还没定主厨'}
                </span>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-[12px]"
                  disabled={assignChef.isPending}
                  onClick={() =>
                    assignChef.mutate({
                      menuId: menu.data!.id,
                      chefId: iAmChef ? null : (session?.member.id ?? null),
                    })
                  }
                >
                  {iAmChef ? '不做了' : '我来做'}
                </Button>
              </div>
            ) : null
          }
        >
          这一餐
        </SectionTitle>

        <Card>
          {menu.isPending ? (
            <p className="px-4 py-6 text-sm text-ink-soft">读取中…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">这一餐还没人点菜</p>
          ) : (
            items.map((item, index) => {
              const step = NEXT_STEP[item.status];
              const open = expanded === item.id;
              return (
                <div key={item.id} className={index ? 'border-t border-border' : ''}>
                  <div className="flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : item.id)}
                      aria-expanded={open}
                      className="min-w-0 flex-1 truncate text-left text-[15px] hover:text-accent"
                    >
                      <span className={item.status === 'rejected' ? 'text-ink-soft line-through' : ''}>
                        {item.dish.name}
                      </span>
                      {item.note ? <span className="ml-2 text-[12px] text-warm">“{item.note}”</span> : null}
                      <span className="ml-2 text-[11px] text-ink-soft">{open ? '收起' : '详情'}</span>
                    </button>
                    <span className="shrink-0 text-xs text-ink-soft">
                      {item.assignedTo ? `${item.assignedTo.name}做` : `${item.requestedBy.name}点的`}
                    </span>
                    <StatusChip status={item.status} />
                    {!locked && step && item.status !== 'rejected' ? (
                      <Button
                        variant="outline"
                        className="h-8 shrink-0 px-2.5 text-[13px]"
                        disabled={updateItem.isPending}
                        onClick={() => updateItem.mutate({ id: item.id, body: { status: step.to } })}
                      >
                        {step.label}
                      </Button>
                    ) : null}
                    {!locked ? (
                      <Button
                        variant="ghost"
                        className="h-8 shrink-0 px-2 text-[13px]"
                        disabled={updateItem.isPending}
                        onClick={() => {
                          if (item.status === 'rejected') {
                            updateItem.mutate({ id: item.id, body: { status: 'pending' } });
                          } else if (item.status === 'accepted' || item.status === 'cooking') {
                            setRejecting({ id: item.id, reason: '' });
                          } else {
                            updateItem.mutate({ id: item.id, body: { status: 'rejected' } });
                          }
                        }}
                      >
                        {item.status === 'rejected' ? '恢复' : '划掉'}
                      </Button>
                    ) : null}
                  </div>
                  {open ? <ItemDetail item={item} locked={locked} date={date} meal={meal} /> : null}
                </div>
              );
            })
          )}

          {menu.data && live.length > 0 && !locked ? (
            <div className="border-t border-border px-4 py-3">
              <Button
                variant="outline"
                className="h-9 w-full text-[13px]"
                disabled={completeMenu.isPending || undone > 0}
                onClick={() => completeMenu.mutate(menu.data!.id)}
              >
                {completeMenu.isPending ? '结束中…' : '这一餐吃完了'}
              </Button>
              {undone > 0 ? (
                <p className="mt-2 text-center text-[12px] text-ink-soft">
                  还有 {undone} 道没做好，做好或划掉之后才能结束
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>

        {menu.data ? (
          <div className="mt-2">
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px]"
              aria-expanded={showLog}
              onClick={() => setShowLog((value) => !value)}
            >
              {showLog ? '收起操作历史' : '看操作历史'}
            </Button>
            {showLog ? (
              <Card className="mt-1 divide-y divide-border">
                {events.isPending ? (
                  <p className="px-4 py-3 text-[13px] text-ink-soft">读取中…</p>
                ) : (events.data ?? []).length === 0 ? (
                  <p className="px-4 py-3 text-[13px] text-ink-soft">这一餐还没有操作</p>
                ) : (
                  (events.data ?? []).map((event) => <EventLine key={event.id} event={event} />)
                )}
              </Card>
            ) : null}
          </div>
        ) : null}
      </section>

      {rejecting ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[680px] px-4 py-3">
            <p className="text-[13px] text-ink-soft">这道菜已经有人接了，划掉要说一句原因</p>
            <div className="mt-2 flex gap-2">
              <Input
                autoFocus
                value={rejecting.reason}
                placeholder="比如：食材不够了"
                onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })}
              />
              <Button
                className="shrink-0"
                disabled={!rejecting.reason.trim() || updateItem.isPending}
                onClick={() =>
                  updateItem.mutate(
                    { id: rejecting.id, body: { status: 'rejected', reason: rejecting.reason.trim() } },
                    { onSuccess: () => setRejecting(null) },
                  )
                }
              >
                划掉
              </Button>
              <Button variant="ghost" className="shrink-0" onClick={() => setRejecting(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
