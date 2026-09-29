import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateStorageLocationBody,
  HomeAsset,
  InventoryBatch,
  InventoryItem,
  StorageLocation,
  StorageLocationContents,
  UpdateStorageLocationBody,
} from '@family/contracts';
import { api } from '../api';
import { invalidateModules } from './modules';

// I1 位置字典。键都以 locations 开头，/events 推 locations 时按前缀一起失效（lib/events.ts）。

export const locationKeys = {
  all: ['locations'] as const,
  list: (includeArchived: boolean) => ['locations', includeArchived ? 'with-archived' : 'active'] as const,
  contents: (id: string) => ['locations', 'contents', id] as const,
};

/** 先序平铺（父在子前），含服务端拼好的 pathLabel。管理页要看归档的传 true。 */
export function useLocations(includeArchived = false) {
  return useQuery({
    queryKey: locationKeys.list(includeArchived),
    queryFn: () => api<StorageLocation[]>(`/locations${includeArchived ? '?includeArchived=true' : ''}`),
  });
}

export function useLocationContents(id: string | null) {
  return useQuery({
    queryKey: locationKeys.contents(id ?? ''),
    queryFn: () => api<StorageLocationContents>(`/locations/${id}/contents`),
    enabled: Boolean(id),
  });
}

function useLocationsInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: locationKeys.all });
    void invalidateModules(client);
  };
}

export function useCreateLocation() {
  const invalidate = useLocationsInvalidation();
  return useMutation({
    mutationFn: (body: CreateStorageLocationBody) => api<StorageLocation>('/locations', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateLocation() {
  const invalidate = useLocationsInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateStorageLocationBody & { id: string }) =>
      api<StorageLocation>(`/locations/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useArchiveLocation() {
  const invalidate = useLocationsInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<StorageLocation>(`/locations/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useDeleteLocation() {
  const invalidate = useLocationsInvalidation();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; removed: true }>(`/locations/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/** 一跳改位置（「找不到 → 改」）：库存物品的默认位置、批次、资产。 */
export function useSetLocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ target, id, locationId }: { target: 'item' | 'batch' | 'asset'; id: string; locationId: string | null }): Promise<unknown> =>
      target === 'item'
        ? api<InventoryItem>(`/inventory-items/${id}`, { method: 'PATCH', body: { defaultLocationId: locationId } })
        : target === 'batch'
          ? api<InventoryBatch>(`/inventory-batches/${id}/location`, { method: 'PATCH', body: { locationId } })
          : api<HomeAsset>(`/assets/${id}/location`, { method: 'PATCH', body: { locationId } }),
    onSuccess: (_data, { target, id }) => {
      for (const key of [locationKeys.all, ['inventory'], ['inventory-batches'], ['assets'], ['asset', id]]) {
        void client.invalidateQueries({ queryKey: key });
      }
      if (target === 'asset') void client.invalidateQueries({ queryKey: ['asset'] });
    },
  });
}
