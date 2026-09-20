import { useMemo, useState } from 'react';
import type { DishCategory, RecipeDish } from '@family/contracts';
import { DISH_CATEGORIES } from '@family/contracts';
import { CATEGORY_EMOJI, useCart } from '../lib/cart';
import { MEAL_LABELS, useRecipes, useRemoveSkill, useUpsertSkill } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { pushToast } from '../lib/toast';
import { Button, Card, Dialog, Input, Page, Panel } from '../components/ui';
import { RecipeEditor } from '../components/recipe-editor';
import { DishEditor } from '../components/dish-editor';

const LEVEL_LABEL: Record<string, string> = {
  learning: '在学',
  can_cook: '会做',
  signature: '拿手菜',
};

function VariantView({
  dish,
  onEdit,
}: {
  dish: RecipeDish;
  onEdit: (variantId: string) => void;
}) {
  const variants = dish.recipeVariants.filter((one) => !one.isArchived);
  const [current, setCurrent] = useState(
    () => variants.find((one) => one.isDefault)?.id ?? variants[0]?.id ?? '',
  );
  const variant = variants.find((one) => one.id === current) ?? variants[0];

  if (!variant) {
    return <p className="py-6 text-center text-[13.5px] text-ink-soft">这道菜还没写做法</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {variants.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {variants.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={one.id === variant.id}
              onClick={() => setCurrent(one.id)}
              className={
                'rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-150 ' +
                (one.id === variant.id
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-border text-ink-soft hover:bg-muted')
              }
            >
              {one.name}
              {one.isDefault ? ' · 家庭默认' : one.author ? ` · ${one.author.name}` : ''}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-soft">
        {variant.estMinutes ? <span>约 {variant.estMinutes} 分钟</span> : null}
        {variant.author ? <span>{variant.author.name} 的写法</span> : null}
        {variant.note ? <span className="text-warm">{variant.note}</span> : null}
        {variant.canManage ? (
          <Button
            variant="ghost"
            className="ml-auto h-8 px-2 text-[13px]"
            onClick={() => onEdit(variant.id)}
          >
            编辑这个做法
          </Button>
        ) : null}
      </div>

      {variant.ingredients.length > 0 ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold tracking-wide text-ink-soft">食材</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {variant.ingredients.map((one) => (
              <div key={one.id} className="flex items-baseline justify-between gap-2 text-[13.5px]">
                <span className="min-w-0 truncate">{one.ingredient.name}</span>
                <span className="shrink-0 font-mono text-[12.5px] text-ink-soft">
                  {one.quantity}
                  {one.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {variant.steps.length > 0 ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold tracking-wide text-ink-soft">做法</p>
          <ol className="flex flex-col gap-3">
            {variant.steps
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((step, index) => (
                <li key={step.id} className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-relaxed">{step.text}</p>
                    {step.imageUrl ? (
                      <img
                        src={step.imageUrl}
                        alt=""
                        loading="lazy"
                        className="mt-2 max-h-52 rounded-lg border border-border object-cover"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ) : null}

      {variant.referenceLinks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {variant.referenceLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-accent hover:bg-muted"
            >
              {link.title || '参考链接'} ↗
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RecipesPage() {
  const recipes = useRecipes();
  const cart = useCart();
  const { session } = useAuth();
  const upsertSkill = useUpsertSkill();
  const removeSkill = useRemoveSkill();
  const [editor, setEditor] = useState<{ dishId: string; variantId: string | null } | null>(null);
  // 菜品本身的编辑（菜名 / 分类 / 照片…）；'new' 表示新建
  const [dishEdit, setDishEdit] = useState<RecipeDish | 'new' | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<DishCategory | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // 做法弹窗要从完整列表里取：换了搜索词或分类也不该把已经打开的那一份关掉
  const openDish = (recipes.data ?? []).find((dish) => dish.id === open) ?? null;

  const word = keyword.trim();
  const visible = useMemo(
    () =>
      (recipes.data ?? []).filter(
        (dish) =>
          (!category || dish.category === category) &&
          (!word ||
            dish.name.includes(word) ||
            dish.ingredients.some((one) => one.ingredient.name.includes(word))),
      ),
    [recipes.data, word, category],
  );

  return (
    <Page
      title="菜谱"
      subtitle={`家里 ${recipes.data?.length ?? 0} 道菜的做法、食材和谁拿手。搜菜名，也能搜食材`}
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setDishEdit('new')}>
          + 新建菜品
        </Button>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <Input
            value={keyword}
            placeholder="搜菜名或食材，比如「西兰花」"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
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
        </div>
      }
    >
      <Panel className="p-3">
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {recipes.isPending ? (
          <p className="px-1 py-6 text-sm text-ink-soft">读取菜谱…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-sm text-ink-soft">没有匹配的菜</p>
        ) : (
          visible.map((dish) => {
            const variants = dish.recipeVariants.filter((one) => !one.isArchived);
            const mySkill = dish.skills.some((skill) => skill.member.id === session?.member.id);
            const editingHere = editor?.dishId === dish.id;
            return (
              <Card key={dish.id} className="overflow-hidden">
                <div className="flex gap-3 p-3">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                    {dish.photoUrl ? (
                      <img
                        src={dish.photoUrl}
                        alt={dish.name}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-3xl">{CATEGORY_EMOJI[dish.category] ?? '🍽️'}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h2 className="text-[16px] font-semibold">{dish.name}</h2>
                      <span className="text-[12px] text-ink-soft">
                        {dish.category} · {dish.estMinutes ? `${dish.estMinutes} 分钟` : '时间灵活'}{' '}
                        · 难度 {dish.difficulty}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft">
                      {dish.ingredients.length > 0
                        ? dish.ingredients
                            .map((one) => `${one.ingredient.name} ${one.quantity}${one.unit}`)
                            .join(' · ')
                        : '还没登记食材'}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-ink-soft">
                        {variants.length} 种做法
                      </span>
                      {dish.skills.slice(0, 3).map((skill) => (
                        <span
                          key={skill.id}
                          className="rounded-full bg-warm-soft px-2 py-0.5 text-[11.5px] text-warm"
                        >
                          {skill.member.avatarEmoji} {skill.member.name}
                          {LEVEL_LABEL[skill.level] ? ` · ${LEVEL_LABEL[skill.level]}` : ''}
                        </span>
                      ))}
                      <Button
                        variant="ghost"
                        className="ml-auto h-8 px-2 text-[13px]"
                        aria-label={`看${dish.name}的做法`}
                        onClick={() => setOpen(dish.id)}
                      >
                        看做法
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[13px]"
                        onClick={() => setEditor({ dishId: dish.id, variantId: null })}
                      >
                        加我的做法
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[13px]"
                        aria-label={`编辑菜品${dish.name}`}
                        onClick={() => setDishEdit(dish)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        className={
                          'h-8 px-2 text-[13px] ' + (mySkill ? 'text-accent' : '')
                        }
                        disabled={upsertSkill.isPending || removeSkill.isPending}
                        onClick={() =>
                          mySkill
                            ? removeSkill.mutate({
                                memberId: session!.member.id,
                                dishId: dish.id,
                              })
                            : upsertSkill.mutate({ dishId: dish.id, level: 'can_cook' })
                        }
                      >
                        {mySkill ? '✓ 我会做' : '标记我会做'}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8 px-2.5 text-[13px]"
                        disabled={cart.has(dish.id)}
                        onClick={() => {
                          cart.add(dish);
                          pushToast(`${dish.name} 已加进${MEAL_LABELS[cart.mealType]}的菜单`);
                        }}
                      >
                        {cart.has(dish.id) ? '在菜单里' : '加进菜单'}
                      </Button>
                    </div>
                  </div>
                </div>

                {editingHere ? (
                  <RecipeEditor
                    dishId={dish.id}
                    dishName={dish.name}
                    editing={
                      editor?.variantId
                        ? (variants.find((one) => one.id === editor.variantId) ?? null)
                        : null
                    }
                    onClose={() => setEditor(null)}
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </div>
      </Panel>

      {openDish ? (
        <Dialog
          title={`${openDish.name} 的做法`}
          maxWidth={680}
          onClose={() => setOpen(null)}
          footer={
            <Button
              className="h-9 w-full"
              onClick={() => {
                setOpen(null);
                setEditor({ dishId: openDish.id, variantId: null });
              }}
            >
              加我的做法
            </Button>
          }
        >
          <VariantView
            dish={openDish}
            onEdit={(variantId) => {
              setOpen(null);
              setEditor({ dishId: openDish.id, variantId });
            }}
          />
        </Dialog>
      ) : null}

      {dishEdit ? (
        <DishEditor
          key={dishEdit === 'new' ? 'new' : dishEdit.id}
          editing={dishEdit === 'new' ? null : dishEdit}
          onClose={() => setDishEdit(null)}
          onCreated={(dish) => setEditor({ dishId: dish.id, variantId: null })}
        />
      ) : null}
    </Page>
  );
}
