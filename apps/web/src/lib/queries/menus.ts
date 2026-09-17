import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddMenuItemsBody,
  Dish,
  MealType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuItem,
  DishRecipeVariant,
  InventoryActionResult,
  MemberDishSkillRecord,
  MemberProfile,
  MenuInventoryPreview,
  RecipeDish,
  ShoppingItem,
  UpdateMenuItemBody,
  UpsertDishBody,
  UpsertDishSkillBody,
  UpsertRecipeVariantBody,
} from '@family/contracts';
import { api } from '../api';

// ---- 点菜 -------------------------------------------------------------------

export function defaultMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'dinner';
}

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

export function useMenu(date: string, mealType: MealType) {
  return useQuery({
    queryKey: ['menu', date, mealType],
    queryFn: () => api<Menu>(`/menus?date=${date}&mealType=${mealType}`),
  });
}

export function useDishes() {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
    staleTime: 5 * 60_000,
  });
}

export function useAddMenuItems(date: string, mealType: MealType) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { menuId: string; items: AddMenuItemsBody['items'] }) =>
      api<Menu>(`/menus/${input.menuId}/items`, { method: 'POST', body: { items: input.items } }),
    onSuccess: (menu) => client.setQueryData(['menu', date, mealType], menu),
  });
}

export function useUpdateMenuItem(date: string, mealType: MealType) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateMenuItemBody }) =>
      api<MenuItem>(`/menu-items/${input.id}`, { method: 'PATCH', body: input.body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['menu', date, mealType] }),
  });
}

export function useMenuDateCounts(start: string, end: string) {
  return useQuery({
    queryKey: ['menu-dates', start, end],
    queryFn: () => api<MenuDateCount[]>(`/menu-dates?start=${start}&end=${end}`),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => api<MemberProfile[]>('/members'),
    staleTime: 10 * 60_000,
  });
}

export function useAssignChef(date: string, mealType: MealType) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { menuId: string; chefId: string | null }) =>
      api<Menu>(`/menus/${input.menuId}/chef`, {
        method: 'PATCH',
        body: { chefId: input.chefId },
      }),
    onSuccess: (menu) => client.setQueryData(['menu', date, mealType], menu),
  });
}

export function useCompleteMenu(date: string, mealType: MealType) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) => api<Menu>(`/menus/${menuId}/complete`, { method: 'POST' }),
    onSuccess: (menu) => client.setQueryData(['menu', date, mealType], menu),
  });
}

export function useCreateDish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertDishBody) => api<Dish>('/dishes', { method: 'POST', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dishes'] });
      void client.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useUpdateDish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpsertDishBody }) =>
      api<Dish>(`/dishes/${input.id}`, { method: 'PATCH', body: input.body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dishes'] });
      void client.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

/** 下架（isActive=false），不是物理删除；菜单里已点过的记录不受影响。 */
export function useRemoveDish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Dish>(`/dishes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['dishes'] });
      void client.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useMenuEvents(menuId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['menu-events', menuId],
    queryFn: () => api<MenuEvent[]>(`/menus/${menuId}/events`),
    enabled: Boolean(menuId) && enabled,
  });
}

/** 单个菜品的菜谱视图（做法版本 + 食材 + 步骤）。只在展开那一行时才拉。 */
export function useRecipe(dishId: string | null) {
  return useQuery({
    queryKey: ['recipe', dishId],
    queryFn: () => api<RecipeDish>(`/recipes/${dishId}`),
    enabled: Boolean(dishId),
    staleTime: 5 * 60_000,
  });
}

/** 厨房那侧看的是「这一天三餐」，不带 mealType 时 /menus 返回三餐数组。 */
export function useMenusOfDate(date: string) {
  return useQuery({
    queryKey: ['menus-of-date', date],
    queryFn: () => api<Menu[]>(`/menus?date=${date}`),
  });
}

export function useMenuMutations(date: string) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['menus-of-date', date] });
    void client.invalidateQueries({ queryKey: ['menu-events'] });
  };
  return {
    updateItem: useMutation({
      mutationFn: (input: { id: string; body: UpdateMenuItemBody }) =>
        api<MenuItem>(`/menu-items/${input.id}`, { method: 'PATCH', body: input.body }),
      onSuccess: refresh,
    }),
    assignChef: useMutation({
      mutationFn: (input: { menuId: string; chefId: string | null }) =>
        api<Menu>(`/menus/${input.menuId}/chef`, { method: 'PATCH', body: { chefId: input.chefId } }),
      onSuccess: refresh,
    }),
    complete: useMutation({
      mutationFn: (menuId: string) => api<Menu>(`/menus/${menuId}/complete`, { method: 'POST' }),
      onSuccess: refresh,
    }),
  };
}

export function useMenuInventoryPreview(menuId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['menu-inventory-preview', menuId],
    queryFn: () => api<MenuInventoryPreview>(`/menus/${menuId}/inventory-preview`),
    enabled,
  });
}

export function useConfirmConsumption() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) =>
      api<InventoryActionResult>(`/menus/${menuId}/confirm-consumption`, { method: 'POST' }),
    onSuccess: (_, menuId) => {
      void client.invalidateQueries({ queryKey: ['menu-inventory-preview', menuId] });
      void client.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useGenerateShoppingList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      api<ShoppingItem[]>('/shopping-list/generate', { method: 'POST', body: { date } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

/** 菜谱库：菜品 + 所有未归档做法 + 会做的人。 */
export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: () => api<RecipeDish[]>('/recipes'),
    staleTime: 5 * 60_000,
  });
}

export function useUpsertVariant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { dishId: string; variantId?: string; body: UpsertRecipeVariantBody }) =>
      input.variantId
        ? api<DishRecipeVariant>(`/recipe-variants/${input.variantId}`, {
            method: 'PATCH',
            body: input.body,
          })
        : api<DishRecipeVariant>(`/dishes/${input.dishId}/recipe-variants`, {
            method: 'POST',
            body: input.body,
          }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['recipes'] });
      void client.invalidateQueries({ queryKey: ['recipe'] });
      void client.invalidateQueries({ queryKey: ['dishes'] });
    },
  });
}

export function useArchiveVariant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) =>
      api<{ id: string }>(`/recipe-variants/${variantId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['recipes'] });
      void client.invalidateQueries({ queryKey: ['recipe'] });
    },
  });
}

export function useUpsertSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertDishSkillBody) =>
      api<MemberDishSkillRecord>('/member-dish-skills', { method: 'POST', body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export function useRemoveSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; dishId: string }) =>
      api<{ removed: true }>(`/members/${input.memberId}/dish-skills/${input.dishId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['recipes'] }),
  });
}
