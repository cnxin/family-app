import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Dish, DishCategory } from '@family/contracts';
import { DISH_CATEGORIES, MEAL_TYPES } from '@family/contracts';
import { CATEGORY_EMOJI, useCart } from '../lib/cart';
import { useAuth } from '../lib/auth';
import {
  MEAL_LABELS,
  shiftDays,
  todayISO,
  useAddMenuItems,
  useCreateDish,
  useDishes,
  useMenu,
  useMenuDateCounts,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Card, Input } from '../components/ui';

function DishCard({
  dish,
  inCart,
  locked,
  onToggle,
}: {
  dish: Dish;
  inCart: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={
        'relative overflow-hidden rounded-card border bg-surface transition-[border-color,box-shadow] duration-150 ' +
        (inCart ? 'border-accent shadow-sm' : 'border-border hover:border-ink-soft/40')
      }
    >
      <div className="grid aspect-[4/3] place-items-center bg-muted">
        {dish.photoUrl ? (
          <img
            src={dish.photoUrl.startsWith('http') ? dish.photoUrl : dish.photoUrl}
            alt={dish.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-4xl">{CATEGORY_EMOJI[dish.category] ?? '🍽️'}</span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-[15px] font-medium">{dish.name}</p>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          {dish.estMinutes ? `${dish.estMinutes} 分钟` : '时间灵活'} · 难度 {dish.difficulty}
        </p>
      </div>
      <button
        type="button"
        aria-label={inCart ? `从菜单移除${dish.name}` : `把${dish.name}加进菜单`}
        aria-pressed={inCart}
        disabled={locked}
        onClick={onToggle}
        className={
          'absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full border text-lg ' +
          'transition-[background-color,border-color,transform] duration-150 active:scale-90 ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 ' +
          (inCart
            ? 'border-accent bg-accent text-white'
            : 'border-border bg-surface text-accent hover:bg-accent-soft')
        }
      >
        {inCart ? '✓' : '＋'}
      </button>
    </div>
  );
}

export function OrderPage() {
  const { session } = useAuth();
  const cart = useCart();
  const today = todayISO();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<DishCategory | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const dishes = useDishes();
  const menu = useMenu(cart.date, cart.mealType);
  const counts = useMenuDateCounts(shiftDays(cart.date, -1), shiftDays(cart.date, 1));
  const addItems = useAddMenuItems(cart.date, cart.mealType);
  const createDish = useCreateDish();

  const locked = menu.data?.status === 'done';
  const alreadyOrdered = (menu.data?.items ?? []).filter((item) => item.status !== 'rejected');

  const word = keyword.trim();
  const visible = useMemo(
    () =>
      (dishes.data ?? []).filter(
        (dish) => (!category || dish.category === category) && (!word || dish.name.includes(word)),
      ),
    [dishes.data, word, category],
  );

  function submit() {
    if (!menu.data || cart.entries.length === 0) return;
    addItems.mutate(
      {
        menuId: menu.data.id,
        items: cart.entries.map((entry) => ({
          dishId: entry.dish.id,
          note: entry.note.trim() || undefined,
        })),
      },
      {
        onSuccess: () => {
          const count = cart.entries.length;
          cart.clear();
          setCartOpen(false);
          pushToast(`${count} 道菜已加进${MEAL_LABELS[cart.mealType]}`);
        },
      },
    );
  }

  async function createAndAdd() {
    if (!word) return;
    const dish = await createDish.mutateAsync({ name: word, category: category ?? '荤菜' });
    cart.add(dish);
    setKeyword('');
  }

  const dayCount = (value: string) => counts.data?.find((row) => row.date === value)?.count ?? 0;

  const cartPanel = (
    <Card className="flex max-h-[70vh] flex-col overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)]">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[15px] font-semibold">你的菜单</p>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {cart.date === today ? '今天' : cart.date.slice(5)} · {MEAL_LABELS[cart.mealType]}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">
          {cart.entries.length} 道
        </span>
      </div>

      {cart.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="text-3xl">🧺</span>
          <p className="text-sm font-medium">菜单还是空的</p>
          <p className="text-[12.5px] text-ink-soft">
            从右边挑今天想吃的，每道都可以写一句备注
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          {cart.entries.map((entry) => (
            <div key={entry.dish.id} className="flex gap-3 border-b border-border px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-lg">
                {CATEGORY_EMOJI[entry.dish.category] ?? '🍽️'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.dish.name}</p>
                  <button
                    type="button"
                    aria-label={`移除${entry.dish.name}`}
                    onClick={() => cart.remove(entry.dish.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[12px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-danger"
                  >
                    移除
                  </button>
                </div>
                <Input
                  value={entry.note}
                  placeholder="备注：少放辣、多加醋…"
                  onChange={(event) => cart.setNote(entry.dish.id, event.target.value)}
                  className="mt-1.5 h-8 text-[13px]"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {cart.entries.length > 0 ? (
          <Button variant="ghost" className="h-10 px-3 text-[13px]" onClick={cart.clear}>
            清空
          </Button>
        ) : null}
        <Button
          className="ml-auto h-10 flex-1 lg:flex-none lg:px-6"
          disabled={cart.entries.length === 0 || locked || addItems.isPending || !menu.data}
          onClick={submit}
        >
          {locked ? '本餐已结束' : addItems.isPending ? '提交中…' : '提交菜单'}
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-6 lg:pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">点菜</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {session?.member.name}，这顿想吃点什么？共 {dishes.data?.length ?? 0} 道家常菜
          </p>
        </div>
        <Link
          to="/kitchen"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-accent transition-colors duration-150 hover:bg-muted"
        >
          去厨房看这一餐 →
        </Link>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label="选择日期"
          value={cart.date}
          onChange={(event) =>
            event.target.value && cart.setTarget(event.target.value, cart.mealType)
          }
          className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        {cart.date === today ? null : (
          <Button
            variant="ghost"
            className="h-9 px-2 text-[13px]"
            onClick={() => cart.setTarget(today, cart.mealType)}
          >
            回今天
          </Button>
        )}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {MEAL_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={cart.mealType === value}
              onClick={() => cart.setTarget(cart.date, value)}
              className={
                'rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
                (cart.mealType === value
                  ? 'bg-surface font-semibold text-ink shadow-sm'
                  : 'text-ink-soft hover:text-ink')
              }
            >
              {MEAL_LABELS[value]}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-soft">
          这餐已点 {alreadyOrdered.length} 道 · 昨天 {dayCount(shiftDays(cart.date, -1))} · 明天{' '}
          {dayCount(shiftDays(cart.date, 1))}
        </span>
      </div>

      {locked ? (
        <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-ink-soft">
          这一餐已经结束，历史菜单锁定了，不能再加菜
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Input value={keyword} placeholder="搜菜名" onChange={(e) => setKeyword(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            {[null, ...DISH_CATEGORIES].map((value) => (
              <button
                key={value ?? 'all'}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={
                  'rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
                  (category === value
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
              >
                {value ? `${CATEGORY_EMOJI[value] ?? ''} ${value}` : '全部'}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {dishes.isPending ? (
              <p className="col-span-full py-6 text-sm text-ink-soft">读取菜品…</p>
            ) : visible.length === 0 ? (
              <div className="col-span-full flex flex-col items-start gap-2 py-6">
                <p className="text-sm text-ink-soft">家里还没有「{word || '这类'}」</p>
                {word && !locked ? (
                  <Button
                    className="h-9 px-3 text-[13px]"
                    disabled={createDish.isPending}
                    onClick={createAndAdd}
                  >
                    {createDish.isPending ? '新建中…' : `新建「${word}」并加进菜单`}
                  </Button>
                ) : null}
              </div>
            ) : (
              visible.map((dish) => (
                <DishCard
                  key={dish.id}
                  dish={dish}
                  locked={locked}
                  inCart={cart.has(dish.id)}
                  onToggle={() => (cart.has(dish.id) ? cart.remove(dish.id) : cart.add(dish))}
                />
              ))
            )}
          </div>
        </div>

        <aside className="hidden lg:block">{cartPanel}</aside>
      </div>

      {/* 窄屏：购物车收在底部，点一下展开 */}
      <div className="fixed inset-x-0 bottom-0 z-20 lg:hidden">
        {cartOpen ? <div className="px-4 pb-2">{cartPanel}</div> : null}
        <div className="border-t border-border bg-bg/90 px-4 py-3 backdrop-blur-xl">
          <Button
            variant={cart.entries.length > 0 ? 'primary' : 'outline'}
            className="h-11 w-full"
            onClick={() => setCartOpen((open) => !open)}
          >
            {cartOpen ? '收起菜单' : `你的菜单 · ${cart.entries.length} 道`}
          </Button>
        </div>
      </div>
    </div>
  );
}
