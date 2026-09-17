import { useMemo, useState } from 'react';
import type {
  DishCategory,
  MealType,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
} from '@family/contracts';
import { DISH_CATEGORIES, MEAL_TYPES } from '@family/contracts';
import {
  MEAL_LABELS,
  defaultMealType,
  shiftDays,
  todayISO,
  useAddMenuItems,
  useAssignChef,
  useCompleteMenu,
  useCreateDish,
  useDishes,
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

export function OrderFullPage() {
  const { session } = useAuth();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(defaultMealType);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<DishCategory | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // 已接单/制作中的菜，后端要求填划掉原因；这里存「正在填原因的那一条」
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const menu = useMenu(date, meal);
  const dishes = useDishes();
  const counts = useMenuDateCounts(shiftDays(date, -1), shiftDays(date, 1));
  const addItems = useAddMenuItems(date, meal);
  const updateItem = useUpdateMenuItem(date, meal);
  const assignChef = useAssignChef(date, meal);
  const completeMenu = useCompleteMenu(date, meal);
  const createDish = useCreateDish();
  const events = useMenuEvents(menu.data?.id, showLog);

  const items = menu.data?.items ?? [];
  const live = items.filter((item) => item.status !== 'rejected');
  const orderedByDish = new Map<string, MenuItem>(live.map((item) => [item.dishId, item]));
  const undone = live.filter((item) => item.status !== 'done').length;
  const locked = menu.data?.status === 'done';
  const iAmChef = menu.data?.chefId === session?.member.id;
  const mine = live.filter((item) => item.assignedToId === session?.member.id).length;

  const word = keyword.trim();
  const visible = useMemo(
    () =>
      (dishes.data ?? []).filter(
        (dish) => (!category || dish.category === category) && (!word || dish.name.includes(word)),
      ),
    [dishes.data, word, category],
  );

  function toggleDish(dishId: string) {
    const existing = orderedByDish.get(dishId);
    if (existing) {
      updateItem.mutate({ id: existing.id, body: { status: 'rejected' } });
      return;
    }
    setPicked((current) =>
      current.includes(dishId) ? current.filter((id) => id !== dishId) : [...current, dishId],
    );
  }

  async function createAndOrder() {
    if (!word || !menu.data) return;
    const dish = await createDish.mutateAsync({ name: word, category: category ?? '荤菜' });
    addItems.mutate({ menuId: menu.data.id, items: [{ dishId: dish.id }] });
    setKeyword('');
  }

  const dayCount = (value: string) => counts.data?.find((row) => row.date === value)?.count ?? 0;

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-32 pt-4">
      <header className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">点菜</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {date === today ? '今天' : date.slice(5)} · {MEAL_LABELS[meal]}
            {locked ? ' · 已结束' : ''}
            {mine > 0 ? ` · 我要做 ${mine} 道` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" className="h-9 w-9 px-0" aria-label="前一天"
            onClick={() => setDate(shiftDays(date, -1))}>‹</Button>
          {/* 直接选任意一天：前后翻页只适合挨着的几天，跨周就该用日期选择器 */}
          <input
            type="date"
            aria-label="选择日期"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink
              transition-colors duration-150 hover:border-ink-soft/40 focus:border-accent
              focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <Button variant="outline" className="h-9 w-9 px-0" aria-label="后一天"
            onClick={() => setDate(shiftDays(date, 1))}>›</Button>
          {date === today ? null : (
            <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setDate(today)}>
              回今天
            </Button>
          )}
        </div>
      </header>

      <div className="mt-4 flex gap-1 rounded-xl bg-muted p-1">
        {MEAL_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMeal(value)}
            aria-pressed={meal === value}
            className={
              'flex-1 rounded-lg py-2 text-sm transition-[background-color,color] duration-150 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
              (meal === value ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-soft hover:text-ink')
            }
          >
            {MEAL_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-ink-soft">
        昨天 {dayCount(shiftDays(date, -1))} 道 · 这天 {dayCount(date)} 道 · 明天 {dayCount(shiftDays(date, 1))} 道
      </p>

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
            <p className="px-4 py-6 text-sm text-ink-soft">还没点菜，从下面挑几道</p>
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
                      {item.note ? (
                        <span className="ml-2 text-[12px] text-warm">“{item.note}”</span>
                      ) : null}
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
                            // 后端要求：已接单或制作中的菜，划掉必须带原因
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
              {/* 后端规则：还有菜没上桌就不让结束（409）。与其让人点了没反应，不如先说清楚。 */}
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

      <section className="mt-7">
        <SectionTitle right={<span className="text-xs text-ink-soft">{visible.length} 道可选</span>}>
          家里的菜
        </SectionTitle>
        <Input value={keyword} placeholder="搜菜名" onChange={(e) => setKeyword(e.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          {[null, ...DISH_CATEGORIES].map((value) => (
            <button
              key={value ?? 'all'}
              type="button"
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
              className={
                'rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
                (category === value
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-border text-ink-soft hover:bg-muted')
              }
            >
              {value ?? '全部'}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {dishes.isPending ? (
            <p className="col-span-full px-1 py-4 text-sm text-ink-soft">读取菜品…</p>
          ) : visible.length === 0 ? (
            <div className="col-span-full flex flex-col items-start gap-2 px-1 py-4">
              <p className="text-sm text-ink-soft">家里还没有「{word || '这类'}」</p>
              {word && !locked ? (
                <Button className="h-9 px-3 text-[13px]" disabled={createDish.isPending} onClick={createAndOrder}>
                  {createDish.isPending ? '新建中…' : `新建「${word}」并点上`}
                </Button>
              ) : null}
            </div>
          ) : (
            visible.map((dish) => {
              const ordered = orderedByDish.has(dish.id);
              const selected = picked.includes(dish.id);
              return (
                <button
                  key={dish.id}
                  type="button"
                  aria-pressed={ordered || selected}
                  disabled={locked || addItems.isPending}
                  onClick={() => toggleDish(dish.id)}
                  className={
                    'flex min-h-[64px] flex-col items-start justify-center gap-1 rounded-card border px-3 py-2 text-left ' +
                    'transition-[background-color,border-color,transform] duration-150 active:scale-[.98] ' +
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 ' +
                    (ordered
                      ? 'border-accent bg-accent-soft'
                      : selected
                        ? 'border-accent bg-surface ring-2 ring-accent/30'
                        : 'border-border bg-surface hover:border-ink-soft/40 hover:bg-muted')
                  }
                >
                  <span className="w-full truncate text-sm font-medium">{dish.name}</span>
                  <span className={`text-[11px] ${ordered || selected ? 'text-accent' : 'text-ink-soft'}`}>
                    {ordered ? '已点 · 再点取消' : selected ? '已选中' : dish.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
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
                    {
                      id: rejecting.id,
                      body: { status: 'rejected', reason: rejecting.reason.trim() },
                    },
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

      {picked.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/85 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[680px] items-center gap-3 px-4 py-3">
            <span className="text-sm text-ink-soft">已选 {picked.length} 道</span>
            <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setPicked([])}>
              清空
            </Button>
            <Button
              className="ml-auto h-10 px-5"
              disabled={addItems.isPending || !menu.data}
              onClick={() =>
                menu.data &&
                addItems.mutate(
                  { menuId: menu.data.id, items: picked.map((dishId) => ({ dishId })) },
                  { onSuccess: () => setPicked([]) },
                )
              }
            >
              {addItems.isPending ? '点菜中…' : `点这 ${picked.length} 道`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
