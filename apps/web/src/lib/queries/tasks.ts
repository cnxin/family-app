import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaskBody,
  HouseholdTask,
  Member,
  TaskOccurrence,
  UpdateTaskBody,
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
    mutationFn: (input: {
      taskId: string;
      dueDate: string;
      body: UpdateTaskInstanceBody;
      /** 乐观更新用，不发给接口。认领时带上当前成员。 */
      assignee?: Member | null;
    }) =>
      api<TaskOccurrence>(`/tasks/${input.taskId}/instances/${input.dueDate}`, {
        method: 'PATCH',
        body: input.body,
      }),
    onMutate: async (input) => {
      if (!Object.prototype.hasOwnProperty.call(input.body, 'assigneeId')) return;
      await client.cancelQueries({ queryKey: ['tasks'] });
      const previous = client.getQueriesData<TaskOccurrence[]>({ queryKey: ['tasks'] });
      const assigneeId = input.body.assigneeId ?? null;
      client.setQueriesData<TaskOccurrence[]>({ queryKey: ['tasks'] }, (rows) =>
        rows?.map((row) =>
          row.taskId === input.taskId && row.dueDate === input.dueDate
            ? { ...row, assigneeId, assignee: assigneeId ? (input.assignee ?? row.assignee) : null }
            : row,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.previous ?? []) client.setQueryData(key, data);
    },
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

/** 改任务定义或停用任务之后：任务列表、日历里的任务条目、留意与家里页状态一起刷新。 */
function invalidateTaskDefinition(client: ReturnType<typeof useQueryClient>) {
  void invalidateModules(client);
  void client.invalidateQueries({ queryKey: ['calendar'] });
  return client.invalidateQueries({ queryKey: ['tasks'] });
}

export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskBody }) =>
      api<HouseholdTask>(`/tasks/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateTaskDefinition(client),
  });
}

/** 服务端的「删除」是停用：之后不再出现，已完成的记录保留。 */
export function useArchiveTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; archived: true }>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTaskDefinition(client),
  });
}
