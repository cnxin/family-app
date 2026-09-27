import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BatchDatesInput,
  InventoryActionResult,
  ShoppingInventoryPreview,
  ShoppingItem,
} from '@family/contracts';
import { api } from '../api';
import { invalidateInventory } from './inventory';

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
