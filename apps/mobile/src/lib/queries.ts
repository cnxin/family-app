import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './api';
import type {
  Dish,
  DishRecipeStep,
  DishReferenceLink,
  Ingredient,
  InventoryCategory,
  InventoryItem,
  Member,
  MealType,
  Menu,
  MenuDateCount,
  MenuEvent,
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

export function useDishes(enabled = true) {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
    enabled,
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

export function useMenuDateCounts(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['menu-dates', start, end],
    queryFn: () =>
      api<MenuDateCount[]>(`/menu-dates?start=${start}&end=${end}`),
    enabled,
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
      void qc.invalidateQueries({ queryKey: ['menu-dates'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
    },
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      status?: MenuItemStatus;
      note?: string;
      assignedToId?: string | null;
      reason?: string;
    }) =>
      api<MenuItem>(`/menu-items/${input.id}`, {
        method: 'PATCH',
        body: {
          status: input.status,
          note: input.note,
          assignedToId: input.assignedToId,
          reason: input.reason,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-dates'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
    },
  });
}

export function useAssignMenuChef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { menuId: string; chefId: string | null }) =>
      api<Menu>(`/menus/${input.menuId}/chef`, {
        method: 'PATCH',
        body: { chefId: input.chefId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
    },
  });
}

export function useCompleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) =>
      api<Menu>(`/menus/${menuId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
    },
  });
}

export function useMenuEvents(menuId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['menu-events', menuId],
    queryFn: () => api<MenuEvent[]>(`/menus/${menuId}/events`),
    enabled,
  });
}

export function useMenuNotifications() {
  return useQuery({
    queryKey: ['menu-notifications'],
    queryFn: () => api<MenuEvent[]>('/menu-notifications'),
    refetchInterval: 30_000,
  });
}

export function useMarkMenuNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MenuEvent>(`/menu-notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['menu-notifications'] }),
  });
}

export function useUpdateCookingPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefersCooking: boolean) =>
      api<Member>('/members/me/preferences', {
        method: 'PATCH',
        body: { prefersCooking },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members'] }),
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
    mutationFn: (input: {
      date: string;
      customName: string;
      totalQty: number;
      unit: string;
    }) =>
      api<ShoppingItem>('/shopping-items', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useDeleteShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/shopping-items/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export interface InventoryUpsertInput {
  id?: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  restockQuantity: number;
}

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<InventoryItem[]>('/inventory'),
  });
}

export function useUpsertInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: InventoryUpsertInput) =>
      id
        ? api<InventoryItem>(`/inventory-items/${id}`, { method: 'PATCH', body })
        : api<InventoryItem>('/inventory-items', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/inventory-items/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
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
  recipeSteps: DishRecipeStep[];
  referenceLinks: DishReferenceLink[];
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
