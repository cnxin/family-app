import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MealType } from '@family/contracts';
import { isDateOnly } from '@family/shared';

export function isMeal(value: string | null): value is MealType {
  return value === 'breakfast' || value === 'lunch' || value === 'dinner';
}

function mealOf(params: URLSearchParams): MealType | null {
  const meal = params.get('meal') ?? params.get('mealType');
  return isMeal(meal) ? meal : null;
}

/**
 * 消费 ?date= 和 ?meal=（F5 的 mealType 仍认）。
 * 读到就进入状态，然后从 URL 抹掉。调用方在内容出来后调 locate，滚到对应餐次。
 */
export function useMealDeepLink(today: string) {
  const [params, setParams] = useSearchParams();
  const meal = useRef(mealOf(params));
  const [date, setDate] = useState(() => {
    const raw = params.get('date');
    return raw && isDateOnly(raw) ? raw : today;
  });

  useEffect(() => {
    if (!params.has('date') && !params.has('meal') && !params.has('mealType')) return;
    const next = new URLSearchParams(params);
    next.delete('date');
    next.delete('meal');
    next.delete('mealType');
    setParams(next, { replace: true });
  }, [params, setParams]);

  function locate(ready: boolean) {
    const target = meal.current;
    if (!target || !ready) return;
    document.getElementById(`meal-${target}`)?.scrollIntoView({ block: 'start' });
    meal.current = null;
  }

  return { date, setDate, locate };
}
