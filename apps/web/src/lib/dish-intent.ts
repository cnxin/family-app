import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type DishIntentStep = 'wait' | 'open' | 'drop';

/** 菜谱列表查询里用得到的那几项；useRecipes() 的结果直接能传。 */
export interface DishListQuery {
  data: readonly { id: string }[] | undefined;
  isFetching: boolean;
  isError: boolean;
}

/**
 * 此刻怎么处理 ?dish=<id>：
 * - 空 id（`?dish=`）→ drop
 * - 列表里有这道菜 → open（后台还在重取也先开）
 * - 没有，但还在加载 / 重取（缓存可能比 ⌘K 的菜品列表旧）→ wait，参数先留着
 * - 没有，且已经取完或取失败（下架、删了、空列表、读不出来）→ drop：只抹参数，不报错
 */
export function dishIntentStep(query: DishListQuery, dishId: string): DishIntentStep {
  if (!dishId) return 'drop';
  if (query.data?.some((dish) => dish.id === dishId)) return 'open';
  if (query.isFetching) return 'wait';
  return query.data === undefined && !query.isError ? 'wait' : 'drop';
}

/**
 * 读 ?dish=<id>（ia-plan「深链约定」：`dish`；⌘K 选菜品带过来）：菜谱到了，菜在就打开那道菜的做法，
 * 然后只把 dish 这一个参数从 URL 抹掉；菜不在也只抹参数。不动搜索词、分类和其他参数。
 * 在菜谱页上再从 ⌘K 选（不重挂载）：参数抹掉后 handled 归零，同一道菜也能再开。
 * onOpen 在渲染期调用，只能是调用方组件自己的 setState。
 */
export function useDishIntent(query: DishListQuery, onOpen: (dishId: string) => void) {
  const [params, setParams] = useSearchParams();
  const linked = params.get('dish'); // 没带是 null；`?dish=` 是 ''，也要抹
  const [handled, setHandled] = useState<string | null>(null);
  if (linked === null && handled !== null) setHandled(null);
  if (linked !== null && handled !== linked) {
    const step = dishIntentStep(query, linked);
    if (step !== 'wait') {
      setHandled(linked);
      if (step === 'open') onOpen(linked);
    }
  }
  useEffect(() => {
    if (linked === null || handled !== linked) return;
    const next = new URLSearchParams(params);
    next.delete('dish');
    setParams(next, { replace: true });
  }, [handled, linked, params, setParams]);
}
