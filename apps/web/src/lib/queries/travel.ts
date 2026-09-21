import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TravelChecklistCategory,
  TravelPackingTemplate,
  TravelPlan,
  TravelPlanStatus,
} from '@family/contracts';
import { api } from '../api';

export const TRAVEL_CATEGORY_LABELS: Record<TravelChecklistCategory, string> = {
  documents: '凭证',
  clothing: '衣物',
  toiletries: '洗护',
  electronics: '电子',
  supplies: '用品',
  other: '其他',
};

export const TRAVEL_CATEGORY_EMOJI: Record<TravelChecklistCategory, string> = {
  documents: '🎫',
  clothing: '👕',
  toiletries: '🧴',
  electronics: '🔌',
  supplies: '🧳',
  other: '📦',
};

/** 归档优先：归档了就显示「已归档」，不管它原来是计划中还是已完成。 */
export function travelStatusLabel(plan: { status: TravelPlanStatus; archivedAt: string | null }) {
  if (plan.archivedAt) return '已归档';
  if (plan.status === 'completed') return '已完成';
  if (plan.status === 'cancelled') return '已取消';
  return '计划中';
}

export function travelDateRange(startDate: string, endDate: string) {
  const format = (value: string) =>
    new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(
      new Date(`${value}T12:00:00`),
    );
  return startDate === endDate ? format(startDate) : `${format(startDate)} - ${format(endDate)}`;
}

export function travelKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function useTravelPlans(status: 'active' | 'completed' | 'cancelled' | 'archived') {
  return useQuery({
    queryKey: ['travel-plans', status],
    queryFn: () => api<TravelPlan[]>(`/travel-plans?status=${status}`),
  });
}

/** 列表里的 appliedTemplateIds 恒为空，要判断模板应用过没有必须看详情。 */
export function useTravelPlan(id: string | undefined) {
  return useQuery({
    queryKey: ['travel-plan', id],
    queryFn: () => api<TravelPlan>(`/travel-plans/${id}`),
    enabled: Boolean(id),
  });
}

export function useTravelTemplates() {
  return useQuery({
    queryKey: ['travel-templates'],
    queryFn: () => api<TravelPackingTemplate[]>('/travel-templates?status=all'),
  });
}

function useTravelMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateModules(client);
      for (const key of [
        'travel-plans',
        'travel-plan',
        'travel-templates',
        'calendar',
        'reminder-sources',
        'reminders',
        'activities',
      ]) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export interface TravelPlanBody {
  title: string;
  destination: string | null;
  startDate: string;
  endDate: string;
  note: string | null;
}

export function useSaveTravelPlan() {
  return useTravelMutation<
    { id?: string; body: TravelPlanBody; expectedVersion?: number; idempotencyKey: string },
    TravelPlan
  >(({ id, body, expectedVersion, idempotencyKey }) =>
    id
      ? api<TravelPlan>(`/travel-plans/${id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion, idempotencyKey },
        })
      : api<TravelPlan>('/travel-plans', { method: 'POST', body: { ...body, idempotencyKey } }),
  );
}

/** 行程的状态流转都是同一个形状：POST 一个动作 + 当前版本号。 */
export function useTravelPlanAction() {
  return useTravelMutation<
    {
      id: string;
      action: 'complete' | 'reopen' | 'cancel' | 'archive' | 'restore';
      expectedVersion: number;
      idempotencyKey: string;
    },
    TravelPlan
  >(({ id, action, expectedVersion, idempotencyKey }) =>
    api<TravelPlan>(`/travel-plans/${id}/${action}`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

export interface TravelItemBody {
  title: string;
  category: TravelChecklistCategory;
  quantity: number;
  note: string | null;
  assignedMemberId: string | null;
}

export function useSaveTravelItem() {
  return useTravelMutation<
    {
      planId: string;
      itemId?: string;
      body: TravelItemBody;
      sortOrder?: number;
      expectedVersion?: number;
      idempotencyKey: string;
    },
    TravelPlan
  >(({ planId, itemId, body, sortOrder, expectedVersion, idempotencyKey }) =>
    itemId
      ? api<TravelPlan>(`/travel-plans/${planId}/items/${itemId}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion, idempotencyKey },
        })
      : api<TravelPlan>(`/travel-plans/${planId}/items`, {
          method: 'POST',
          body: { ...body, sortOrder, idempotencyKey },
        }),
  );
}

export function useTravelItemAction() {
  return useTravelMutation<
    {
      planId: string;
      itemId: string;
      action: 'complete' | 'restore' | 'skip' | 'archive';
      expectedVersion: number;
      idempotencyKey: string;
    },
    TravelPlan
  >(({ planId, itemId, action, expectedVersion, idempotencyKey }) =>
    api<TravelPlan>(`/travel-plans/${planId}/items/${itemId}/${action}`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

export function useSaveTravelTemplate() {
  return useTravelMutation<
    {
      id?: string;
      body: {
        title: string;
        description: string | null;
        items: { title: string; category: TravelChecklistCategory; quantity: number }[];
      };
      expectedVersion?: number;
      idempotencyKey: string;
    },
    TravelPackingTemplate
  >(({ id, body, expectedVersion, idempotencyKey }) =>
    id
      ? api<TravelPackingTemplate>(`/travel-templates/${id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion, idempotencyKey },
        })
      : api<TravelPackingTemplate>('/travel-templates', {
          method: 'POST',
          body: { ...body, idempotencyKey },
        }),
  );
}

export function useTravelTemplateAction() {
  return useTravelMutation<
    {
      id: string;
      action: 'archive' | 'restore';
      expectedVersion: number;
      idempotencyKey: string;
    },
    TravelPackingTemplate
  >(({ id, action, expectedVersion, idempotencyKey }) =>
    api<TravelPackingTemplate>(`/travel-templates/${id}/${action}`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

/** 同一个模板对同一个行程只能应用一次，重复应用后端 409。 */
export function useApplyTravelTemplate() {
  return useTravelMutation<
    {
      planId: string;
      templateId: string;
      expectedPlanVersion: number;
      expectedTemplateVersion: number;
      idempotencyKey: string;
    },
    TravelPlan
  >(({ planId, templateId, ...body }) =>
    api<TravelPlan>(`/travel-plans/${planId}/templates/${templateId}/apply`, {
      method: 'POST',
      body,
    }),
  );
}
