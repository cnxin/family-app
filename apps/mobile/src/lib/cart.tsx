import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { todayStr } from './date';
import type { Dish, MealType } from './types';

export interface CartEntry {
  dish: Dish;
  note: string;
}

interface Cart {
  date: string; // YYYY-MM-DD
  mealType: MealType;
  entries: CartEntry[];
  setTarget: (date: string, mealType: MealType) => void;
  add: (dish: Dish, note?: string) => void;
  remove: (dishId: string) => void;
  clear: () => void;
  has: (dishId: string) => boolean;
}

const CartContext = createContext<Cart>(null as unknown as Cart);

// 按当前时间给出更贴近日常使用的默认餐次。
export function defaultMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 9) return 'breakfast';
  return hour >= 15 ? 'dinner' : 'lunch';
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [date, setDate] = useState(todayStr());
  const [mealType, setMealType] = useState<MealType>(defaultMealType());
  const [entries, setEntries] = useState<CartEntry[]>([]);

  const setTarget = useCallback((d: string, m: MealType) => {
    setDate(d);
    setMealType(m);
  }, []);

  const add = useCallback((dish: Dish, note = '') => {
    setEntries((prev) =>
      prev.some((e) => e.dish.id === dish.id)
        ? prev.map((e) => (e.dish.id === dish.id ? { ...e, note } : e))
        : [...prev, { dish, note }],
    );
  }, []);

  const remove = useCallback((dishId: string) => {
    setEntries((prev) => prev.filter((e) => e.dish.id !== dishId));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const has = useCallback(
    (dishId: string) => entries.some((e) => e.dish.id === dishId),
    [entries],
  );

  const value = useMemo(
    () => ({ date, mealType, entries, setTarget, add, remove, clear, has }),
    [date, mealType, entries, setTarget, add, remove, clear, has],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
