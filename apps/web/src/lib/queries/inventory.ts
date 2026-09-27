import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BatchDatesInput,
  CreateInventoryItemBody,
  InventoryActionResult,
  InventoryBatch,
  InventoryItem,
  InventoryTransaction,
} from '@family/contracts';
import { api } from '../api';

// ---- 库存 -------------------------------------------------------------------

/** 一次库存变动会同时改动清单、流水、批次和菜单扣库预览，所以统一失效。 */
export function invalidateInventory(client: ReturnType<typeof useQueryClient>) {
  void invalidateModules(client);
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
