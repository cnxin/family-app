import { useMemo, useState } from 'react';
import type { DishCategory, MealType, MenuItemStatus } from '@family/contracts';
import { DISH_CATEGORIES, MEAL_TYPES } from '@family/contracts';
import {
  MEAL_LABELS,
  defaultMealType,
  todayISO,
  useAddMenuItems,
  useDishes,
  useMenu,
  useUpdateMenuItem,
} from '../lib/queries';
import { Button, Card, Input, SectionTitle } from '../components/ui';

const STATUS_LABEL: Record<MenuItemStatus, string> = {
  pending: '待接',
  accepted: '已接',
  cooking: '在做',
  done: '做好了',
  rejected: '已划掉',
};

function StatusChip({ status }: { status: MenuItemStatus }) {
  const tone =
    status === 'done'
      ? 'bg-accent-soft text-accent'
      : status === 'rejected'
        ? 'bg-muted text-ink-soft'
        : status === 'cooking'
          ? 'bg-warm-soft text-warm'
          : 'bg-muted text-ink-soft';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function OrderPage() {
  const date = todayISO();
  const [meal, setMeal] = useState<MealType>(defaultMealType);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<DishCategory | null>(null);

  const menu = useMenu(date, meal);
  const dishes = useDishes();
  const addItems = useAddMenuItems(date, meal);
  const updateItem = useUpdateMenuItem(date, meal);

  const items = menu.data?.items ?? [];
  const live = items.filter((item) => item.status !== 'rejected');
  const orderedIds = new Set(live.map((item) => item.dishId));

  const visible = useMemo(() => {
    const word = keyword.trim();
    return (dishes.data ?? []).filter(
      (dish) =>
        (!category || dish.category === category) && (!word || dish.name.includes(word)),
    );
  }, [dishes.data, keyword, category]);

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-6">
      <header className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">点菜</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {menu.isPending
            ? '读取今天的菜单…'
            : live.length === 0
              ? `${MEAL_LABELS[meal]}还没人点菜`
              : `${MEAL_LABELS[meal]}已点 ${live.length} 道${
                  menu.data?.chef ? ` · ${menu.data.chef.name}掌勺` : ''
                }`}
        </p>
      </header>

      <div className="mt-5 flex gap-1 rounded-xl bg-muted p-1">
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

      <section className="mt-6">
        <SectionTitle>这一餐</SectionTitle>
        <Card>
          {menu.isPending ? (
            <p className="px-4 py-6 text-sm text-ink-soft">读取中…</p>
          ) : menu.isError ? (
            <p className="px-4 py-6 text-sm text-danger">读不到菜单</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-soft">还没点菜，从下面挑几道</p>
          ) : (
            items.map((item, index) => (
              <div
                key={item.id}
                className={`flex min-h-[52px] items-center gap-3 px-4 py-3 ${
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
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px]"
                  disabled={updateItem.isPending}
                  onClick={() =>
                    updateItem.mutate({
                      id: item.id,
                      body: { status: item.status === 'rejected' ? 'pending' : 'rejected' },
                    })
                  }
                >
                  {item.status === 'rejected' ? '恢复' : '划掉'}
                </Button>
              </div>
            ))
          )}
        </Card>
      </section>

      <section className="mt-7">
        <SectionTitle right={<span className="text-xs text-ink-soft">{visible.length} 道可选</span>}>
          家里的菜
        </SectionTitle>

        <Input
          value={keyword}
          placeholder="搜菜名"
          onChange={(event) => setKeyword(event.target.value)}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory(null)}
            aria-pressed={category === null}
            className={
              'rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
              (category === null
                ? 'border-accent bg-accent-soft font-medium text-accent'
                : 'border-border text-ink-soft hover:bg-muted')
            }
          >
            全部
          </button>
          {DISH_CATEGORIES.map((value) => (
            <button
              key={value}
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
              {value}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {dishes.isPending ? (
            <p className="col-span-full px-1 py-4 text-sm text-ink-soft">读取菜品…</p>
          ) : visible.length === 0 ? (
            <p className="col-span-full px-1 py-4 text-sm text-ink-soft">没有匹配的菜</p>
          ) : (
            visible.map((dish) => {
              const already = orderedIds.has(dish.id);
              return (
                <button
                  key={dish.id}
                  type="button"
                  disabled={already || addItems.isPending || !menu.data}
                  onClick={() =>
                    menu.data &&
                    addItems.mutate({ menuId: menu.data.id, items: [{ dishId: dish.id }] })
                  }
                  className={
                    'flex min-h-[64px] flex-col items-start justify-center gap-1 rounded-card border px-3 py-2 text-left ' +
                    'transition-[background-color,border-color,transform] duration-150 active:scale-[.98] ' +
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                    (already
                      ? 'cursor-default border-accent/40 bg-accent-soft'
                      : 'border-border bg-surface hover:border-ink-soft/40 hover:bg-muted')
                  }
                >
                  <span className="w-full truncate text-sm font-medium">{dish.name}</span>
                  <span className="text-[11px] text-ink-soft">
                    {already ? '已点' : dish.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
