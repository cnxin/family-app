import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddMenuItemsBody,
  CalendarEntry,
  CalendarEvent,
  CreateCalendarEventBody,
  CreateReminderBody,
  HouseholdReminder,
  ReminderSource,
  ReminderStatus,
  CreateTaskBody,
  Dish,
  HouseholdTask,
  MealType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuItem,
  DishRecipeVariant,
  BatchDatesInput,
  CreateInventoryItemBody,
  InventoryActionResult,
  InventoryBatch,
  InventoryItem,
  InventoryTransaction,
  MemberDishSkillRecord,
  MemberProfile,
  MenuInventoryPreview,
  RecipeDish,
  ShoppingInventoryPreview,
  ShoppingItem,
  TaskOccurrence,
  UpdateMenuItemBody,
  UpdateTaskInstanceBody,
  UpsertDishBody,
  UpsertDishSkillBody,
  UpsertRecipeVariantBody,
} from '@family/contracts';
import { api } from './api';

export function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function shiftDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function useTaskRange(start: string, end: string) {
  return useQuery({
    queryKey: ['tasks', start, end],
    queryFn: () => api<TaskOccurrence[]>(`/tasks?start=${start}&end=${end}`),
  });
}

export function useUpdateOccurrence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; dueDate: string; body: UpdateTaskInstanceBody }) =>
      api<TaskOccurrence>(`/tasks/${input.taskId}/instances/${input.dueDate}`, {
        method: 'PATCH',
        body: input.body,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) =>
      api<HouseholdTask>('/tasks', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

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
    onSuccess: () => client.invalidateQueries({ queryKey: ['dishes'] }),
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

// ---- 购物清单 ---------------------------------------------------------------

export function useShoppingList(date: string) {
  return useQuery({
    queryKey: ['shopping', date],
    queryFn: () => api<ShoppingItem[]>(`/shopping-list?date=${date}`),
  });
}

export function useCheckShoppingItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; checked: boolean }) =>
      api<ShoppingItem>(`/shopping-items/${input.id}`, {
        method: 'PATCH',
        body: { checked: input.checked },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useAddManualShoppingItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; customName: string; totalQty: number; unit: string }) =>
      api<ShoppingItem>('/shopping-items', { method: 'POST', body: input }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useDeleteShoppingItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/shopping-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

/** 入库预览：候选库存项 + 预计前后量。不选具体库存项时后端自己挑同单位的。 */
export function useShoppingInventoryPreview(
  shoppingItemId: string | null,
  inventoryItemId: string | null,
  enabled: boolean,
) {
  const suffix = inventoryItemId
    ? `?inventoryItemId=${encodeURIComponent(inventoryItemId)}`
    : '';
  return useQuery({
    queryKey: ['shopping-inventory-preview', shoppingItemId, inventoryItemId],
    queryFn: () =>
      api<ShoppingInventoryPreview>(
        `/shopping-items/${shoppingItemId}/inventory-preview${suffix}`,
      ),
    enabled: enabled && Boolean(shoppingItemId),
  });
}

export function useConfirmShoppingReceipt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      shoppingItemId: string;
      inventoryItemId?: string;
      batch?: BatchDatesInput;
    }) =>
      api<InventoryActionResult>(`/shopping-items/${input.shoppingItemId}/confirm-stock`, {
        method: 'POST',
        body: { inventoryItemId: input.inventoryItemId, batch: input.batch },
      }),
    onSuccess: () => invalidateInventory(client),
  });
}

// ---- 库存 -------------------------------------------------------------------

/** 一次库存变动会同时改动清单、流水、批次和菜单扣库预览，所以统一失效。 */
function invalidateInventory(client: ReturnType<typeof useQueryClient>) {
  for (const key of [
    ['inventory'],
    ['inventory-transactions'],
    ['inventory-batches'],
    ['shopping'],
    ['shopping-inventory-preview'],
    ['menu-inventory-preview'],
  ]) {
    void client.invalidateQueries({ queryKey: key });
  }
}

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<InventoryItem[]>('/inventory'),
  });
}

export type InventoryUpsertInput = Partial<CreateInventoryItemBody> & { id?: string };

export function useUpsertInventoryItem() {
  const client = useQueryClient();
  return useMutation({
    // 改 quantity 会记一条 adjustment 流水，后端要求 idempotencyKey 防重复
    mutationFn: ({ id, ...body }: InventoryUpsertInput) =>
      id
        ? api<InventoryItem>(`/inventory-items/${id}`, {
            method: 'PATCH',
            body: {
              ...body,
              idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            },
          })
        : api<InventoryItem>('/inventory-items', { method: 'POST', body }),
    onSuccess: () => invalidateInventory(client),
  });
}

export function useDeleteInventoryItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/inventory-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateInventory(client),
  });
}

export function useInventoryTransactions(limit = 40) {
  return useQuery({
    queryKey: ['inventory-transactions', limit],
    queryFn: () => api<InventoryTransaction[]>(`/inventory-transactions?limit=${limit}`),
  });
}

export function useReverseInventoryTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<InventoryActionResult>(`/inventory-transactions/${id}/reverse`, { method: 'POST' }),
    onSuccess: () => invalidateInventory(client),
  });
}

export function useInventoryBatches(
  status: 'all' | 'active' | 'expiring' | 'expired' = 'all',
  days = 7,
) {
  return useQuery({
    queryKey: ['inventory-batches', status, days],
    queryFn: () => api<InventoryBatch[]>(`/inventory-batches?status=${status}&days=${days}`),
  });
}

export function useCreateInventoryBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BatchDatesInput & { inventoryItemId: string; quantity: number }) =>
      api<InventoryBatch>('/inventory-batches', {
        method: 'POST',
        body: {
          ...input,
          idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      }),
    onSuccess: () => invalidateInventory(client),
  });
}

export function useUpdateInventoryBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BatchDatesInput & { id: string; expectedVersion: number }) => {
      const { id, ...body } = input;
      return api<InventoryBatch>(`/inventory-batches/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => invalidateInventory(client),
  });
}

// ---- 日历 -------------------------------------------------------------------

/** 一次拉一个月（六周网格的首尾两天为界），月份切换就是换 key。 */
export function useCalendarEntries(start: string, end: string) {
  return useQuery({
    queryKey: ['calendar', start, end],
    queryFn: () => api<CalendarEntry[]>(`/calendar?start=${start}&end=${end}`),
  });
}

export function useUpsertCalendarEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; body: CreateCalendarEventBody }) =>
      input.id
        ? api<CalendarEvent>(`/calendar-events/${input.id}`, {
            method: 'PATCH',
            body: input.body,
          })
        : api<CalendarEvent>('/calendar-events', { method: 'POST', body: input.body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

export function useDeleteCalendarEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/calendar-events/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['calendar'] }),
  });
}

// ---- 提醒 -------------------------------------------------------------------

/**
 * 提醒是有时效的：到点了后台会发出去，状态从 scheduled 变 sent。
 * 所以待发的列表要轮询，否则页面上会一直挂着一条其实已经发了的。
 */
export function useReminders(status: ReminderStatus | 'all' = 'all') {
  return useQuery({
    queryKey: ['reminders', status],
    queryFn: () => api<HouseholdReminder[]>(`/reminders?status=${status}`),
    refetchInterval: status === 'scheduled' || status === 'all' ? 15_000 : false,
  });
}

/** 可被提醒的事项：日历条目 + 开放投票 + 启用的维护计划，一次拉一年。 */
export function useReminderSources(start: string, end: string) {
  return useQuery({
    queryKey: ['reminder-sources', start, end],
    queryFn: () => api<ReminderSource[]>(`/reminder-sources?start=${start}&end=${end}`),
    staleTime: 60_000,
  });
}

export function useUpsertReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CreateReminderBody & { id?: string }) =>
      id
        ? api<HouseholdReminder>(`/reminders/${id}`, {
            method: 'PATCH',
            // 改的时候只能动时间和接收人，来源是定死的
            body: { remindAt: body.remindAt, recipientIds: body.recipientIds },
          })
        : api<HouseholdReminder>('/reminders', { method: 'POST', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['reminders'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useCancelReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<HouseholdReminder>(`/reminders/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
