import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaskBody,
  HouseholdTask,
  TaskOccurrence,
  UpdateTaskInstanceBody,
} from '@family/contracts';
import { api } from '../api';

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
    onSuccess: () => {
      void invalidateModules(client);
      return client.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) =>
      api<HouseholdTask>('/tasks', { method: 'POST', body }),
    onSuccess: () => {
      void invalidateModules(client);
      return client.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
