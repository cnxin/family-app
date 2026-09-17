import { useMemo, useState } from 'react';
import type { DishCategory, MealType, MenuItem, MenuItemStatus } from '@family/contracts';
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
  useMenu,
  useMenuDateCounts,
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

/** 厨房这侧的下一步动作：待接 → 接单 → 开始做 → 做好了。 */
const NEXT_STEP: Partial<Record<MenuItemStatus, { to: MenuItemStatus; label: string }>> = {
  pending: { to: 'accepted', label: '接单' },
  accepted: { to: 'cooking', label: '开始做' },
  cooking: { to: 'done', label: '做好了' },
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

function weekdayLabel(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return '周' + '日一二三四五六'[day];
}

export function OrderSimplePage() {
  const { session } = useAuth();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(defaultMealType);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<DishCategory | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // 已接单/制作中的菜，后端要求填划掉原因；这里存「正在填原因的那一条」
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const menu = useMenu(date, meal);
  const dishes = useDishes();
  const counts = useMenuDateCounts(shiftDays(date, -1), shiftDays(date, 1));
  const addItems = useAddMenuItems(date, meal);
  const updateItem = useUpdateMenuItem(date, meal);
  const assignChef = useAssignChef(date, meal);
  const completeMenu = useCompleteMenu(date, meal);
  const createDish = useCreateDish();

  const items = menu.data?.items ?? [];
  const live = items.filter((item) => item.status !== 'rejected');
  const orderedByDish = new Map<string, MenuItem>(live.map((item) => [item.dishId, item]));
  const undone = live.filter((item) => item.status !== 'done').length;
  const locked = menu.data?.status === 'done';
  const iAmChef = menu.data?.chefId === session?.member.id;

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

  function commit() {
    if (!menu.data || picked.length === 0) return;
    addItems.mutate(
      { menuId: menu.data.id, items: picked.map((dishId) => ({ dishId })) },
      { onSuccess: () => setPicked([]) },
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
    <div className="mx-auto w-full max-w-[680px] px-4 pb-32 pt-6">
      <header className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">点菜</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {date === today ? '今天' : `${date.slice(5)} ${weekdayLabel(date)}`}
            {locked ? ' · 这一餐已结束' : ''}
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
              (meal === value
                ? 'bg-surface font-semibold text-ink shadow-sm'
                : 'text-ink-soft hover:text-ink')
            }
          >
            {MEAL_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-ink-soft">
        昨天点了 {dayCount(shiftDays(date, -1))} 道 · 这天 {dayCount(date)} 道 · 明天{' '}
        {dayCount(shiftDays(date, 1))} 道
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
          ) : menu.isError ? (
            <p className="px-4 py-6 text-sm text-danger">读不到菜单</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">还没点菜，从下面挑几道</p>
          ) : (
            items.map((item, index) => {
              const step = NEXT_STEP[item.status];
              return (
                <div
                  key={item.id}
                  className={`flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${
                    index ? 'border-t border-border' : ''
                  }`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-[15px] ${
                      item.status === 'rejected' ? 'text-ink-soft line-through' : ''
                    }`}
                  >
                    {item.dish.name}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">{item.requestedBy.name}点的</span>
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
                <Button
                  className="h-9 px-3 text-[13px]"
                  disabled={createDish.isPending || addItems.isPending}
                  onClick={createAndOrder}
                >
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
                        ? 'border-accent ring-2 ring-accent/30 bg-surface'
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
            <Button className="ml-auto h-10 px-5" disabled={addItems.isPending} onClick={commit}>
              {addItems.isPending ? '点菜中…' : `点这 ${picked.length} 道`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
