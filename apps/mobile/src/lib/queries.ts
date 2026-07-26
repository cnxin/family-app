import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './api';
import type {
  Dish,
  Ingredient,
  Member,
  MealType,
  Menu,
  MenuItem,
  MenuItemStatus,
  ShoppingItem,
} from './types';

export function useMembers(enabled = true) {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/members'),
    enabled,
  });
}

export function useDishes() {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
  });
}

export function useIngredients() {
  return useQuery({
    queryKey: ['ingredients'],
    queryFn: () => api<Ingredient[]>('/ingredients'),
  });
}

export function useMenu(date: string, mealType: MealType) {
  return useQuery({
    queryKey: ['menu', date, mealType],
    queryFn: () => api<Menu>(`/menus?date=${date}&mealType=${mealType}`),
  });
}

export function useMenusOfDate(date: string) {
  return useQuery({
    queryKey: ['menus', date],
    queryFn: () => api<Menu[]>(`/menus?date=${date}`),
  });
}

export function useAddMenuItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      menuId: string;
      items: { dishId: string; note?: string }[];
    }) =>
      api<Menu>(`/menus/${input.menuId}/items`, {
        method: 'POST',
        body: { items: input.items },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
    },
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status?: MenuItemStatus; note?: string }) =>
      api<MenuItem>(`/menu-items/${input.id}`, {
        method: 'PATCH',
        body: { status: input.status, note: input.note },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
    },
  });
}

export function useShoppingList(date: string) {
  return useQuery({
    queryKey: ['shopping', date],
    queryFn: () => api<ShoppingItem[]>(`/shopping-list?date=${date}`),
  });
}

export function useGenerateShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      api<ShoppingItem[]>('/shopping-list/generate', {
        method: 'POST',
        body: { date },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useCheckShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; checked: boolean }) =>
      api<ShoppingItem>(`/shopping-items/${input.id}`, {
        method: 'PATCH',
        body: { checked: input.checked },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useAddManualShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; customName: string }) =>
      api<ShoppingItem>('/shopping-items', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export interface DishUpsertInput {
  id?: string;
  name: string;
  category: string;
  difficulty: number;
  estMinutes?: number;
  note?: string;
  photoUrl?: string;
  ingredients: { name: string; quantity: number; unit: string; category?: string }[];
}

export function useUpsertDish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DishUpsertInput) =>
      id
        ? api<Dish>(`/dishes/${id}`, { method: 'PATCH', body })
        : api<Dish>('/dishes', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dishes'] }),
  });
}

export function useRemoveDish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/dishes/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dishes'] }),
  });
}
