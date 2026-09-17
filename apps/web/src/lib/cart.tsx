import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Dish, MealType } from '@family/contracts';
import { defaultMealType, todayISO } from './queries';

/** 购物车语义照搬旧客户端 apps/mobile/src/lib/cart.tsx：
 *  选菜只进购物车，备注在点菜当下就写，最后一次性「提交菜单」。
 *  换日期或换餐次时车不清空——挑到一半改主意去晚餐，不该白挑。 */
export interface CartEntry {
  dish: Dish;
  note: string;
}

interface Cart {
  date: string;
  mealType: MealType;
  entries: CartEntry[];
  setTarget: (date: string, mealType: MealType) => void;
  add: (dish: Dish, note?: string) => void;
  setNote: (dishId: string, note: string) => void;
  remove: (dishId: string) => void;
  clear: () => void;
  has: (dishId: string) => boolean;
}

const CartContext = createContext<Cart | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState(todayISO);
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [entries, setEntries] = useState<CartEntry[]>([]);

  const setTarget = useCallback((nextDate: string, nextMeal: MealType) => {
    setDate(nextDate);
    setMealType(nextMeal);
  }, []);

  const add = useCallback((dish: Dish, note = '') => {
    setEntries((current) =>
      current.some((entry) => entry.dish.id === dish.id)
        ? current
        : [...current, { dish, note }],
    );
  }, []);

  const setNote = useCallback((dishId: string, note: string) => {
    setEntries((current) =>
      current.map((entry) => (entry.dish.id === dishId ? { ...entry, note } : entry)),
    );
  }, []);

  const remove = useCallback((dishId: string) => {
    setEntries((current) => current.filter((entry) => entry.dish.id !== dishId));
  }, []);

  const clear = useCallback(() => setEntries([]), []);
  const has = useCallback(
    (dishId: string) => entries.some((entry) => entry.dish.id === dishId),
    [entries],
  );

  const value = useMemo(
    () => ({ date, mealType, entries, setTarget, add, setNote, remove, clear, has }),
    [date, mealType, entries, setTarget, add, setNote, remove, clear, has],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart 必须在 CartProvider 里用');
  return value;
}

export const CATEGORY_EMOJI: Record<string, string> = {
  荤菜: '🍖',
  素菜: '🥬',
  汤: '🥣',
  主食: '🍚',
  甜品: '🍮',
};
