import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddMenuItemsBody,
  CreateTaskBody,
  Dish,
  HouseholdTask,
  MealType,
  Menu,
  MenuItem,
  TaskOccurrence,
  UpdateMenuItemBody,
  UpdateTaskInstanceBody,
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
