import type { Menu, MenuItem } from '@family/contracts';
import { CATEGORY_EMOJI } from '../lib/cart';
import { MEAL_LABELS } from '../lib/queries';
import { Skeleton } from './skeleton';
import { SoftLink } from './soft-link';

const ORDER: Menu['mealType'][] = ['breakfast', 'lunch', 'dinner'];

/** 一道菜的小方块：有照片用照片，没有就用分类 emoji 兜底，别留空洞。 */
function DishTile({ item }: { item: MenuItem }) {
  const photo = item.dish.photoUrl;
  return (
    <span
      title={item.dish.name}
      className={
        // 格子跟着卡片宽度缩，不能 shrink-0：四个 48px 的方块加间距是 210px，
        // 比卡片里能用的宽度还宽，实测撑出去 11px。max-w 是另一头的保险——
        // 只有一道菜的时候别把这一格拉成一条横幅
        'grid h-12 min-w-0 max-w-[56px] flex-1 place-items-center overflow-hidden rounded-lg ' +
        'bg-muted text-[19px] ' +
        (item.status === 'done' ? 'opacity-55' : '')
      }
    >
      {photo ? (
        <img src={photo} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        (CATEGORY_EMOJI[item.dish.category] ?? '🍽️')
      )}
    </span>
  );
}

function MealCard({ menu, date }: { menu: Menu; date: string }) {
  const live = menu.items.filter((item) => item.status !== 'rejected');
  const done = live.filter((item) => item.status === 'done').length;
  const names = live.map((item) => item.dish.name).join('、');

  const query = `date=${encodeURIComponent(date)}&meal=${menu.mealType}`;
  return (
    <SoftLink
      to={live.length ? `/eat/kitchen?${query}` : `/eat/order?${query}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface p-3 transition-colors duration-150 hover:border-ink-soft/35 hover:bg-muted/40"
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{MEAL_LABELS[menu.mealType]}</span>
        {live.length ? (
          <span
            className={
              'rounded-full px-1.5 py-0.5 text-[11px] ' +
              (done === live.length
                ? 'bg-accent-soft text-accent'
                : done
                  ? 'bg-warm-soft text-warm'
                  : 'bg-muted text-ink-soft')
            }
          >
            {done === live.length ? '已上桌' : done ? `${done}/${live.length}` : `${live.length} 道`}
          </span>
        ) : null}
        {menu.chef ? (
          <span className="ml-auto shrink-0 truncate text-[12px] text-ink-soft">
            {menu.chef.avatarEmoji} {menu.chef.name}
          </span>
        ) : null}
      </div>

      {live.length ? (
        <>
          <div className="mt-2.5 flex gap-1.5">
            {live.slice(0, 3).map((item) => (
              <DishTile key={item.id} item={item} />
            ))}
            {live.length > 3 ? (
              <span className="grid h-12 min-w-0 max-w-[56px] flex-1 place-items-center rounded-lg bg-muted text-[12px] text-ink-soft">
                +{live.length - 3}
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-soft">{names}</p>
        </>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-ink-soft">还没点 · 去点一个 →</p>
      )}
    </SoftLink>
  );
}

/** 三餐并排，一眼看见今天吃什么——首页的主角就是这一块。 */
export function TodayMeals({
  menus,
  date,
  pending,
}: {
  menus: Menu[];
  date: string;
  pending: boolean;
}) {
  if (pending) {
    return (
      <div className="grid gap-2.5 sm:grid-cols-3">
        {ORDER.map((key) => (
          <div key={key} className="rounded-card border border-border bg-surface p-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="mt-3 h-12 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  const byMeal = ORDER.map(
    (meal) =>
      menus.find((menu) => menu.mealType === meal) ?? {
        id: `empty-${meal}`,
        mealType: meal,
        items: [],
        chef: null,
      },
  ) as Menu[];

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {byMeal.map((menu) => (
        <MealCard key={menu.mealType} menu={menu} date={date} />
      ))}
    </div>
  );
}
