import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetDocumentType,
  MaintenanceCompletionResult,
  MaintenanceConsumable,
  MaintenanceConsumablesPreview,
  MaintenanceShoppingResult,
} from '@family/contracts';

/**
 * 新建/修改回传的是「记录版」形状（计划没有 consumables、资料没有 createdBy），
 * 比详情里的那一版要瘦。这里的写操作都只用到 id，回来靠重新拉详情刷新，
 * 所以只声明用得上的字段，别套用详情的类型给自己挖坑。
 */
type Saved = { id: string };
import { api, postForm } from '../api';
import { invalidateAssets } from './assets';

function useAssetMutation<TInput, TResult>(
  run: (input: TInput & { assetId: string }) => Promise<TResult>,
  extraKeys: string[] = [],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_result, input) => {
      invalidateAssets(client, input.assetId);
      for (const key of extraKeys) void client.invalidateQueries({ queryKey: [key] });
    },
  });
}

// ---- 维护计划 ---------------------------------------------------------------

export function useCreateMaintenancePlan() {
  return useAssetMutation<
    { title: string; frequencyDays: number; nextDueDate: string; note?: string | null },
    Saved
  >(({ assetId, ...body }) =>
    api<Saved>(`/assets/${assetId}/maintenance-plans`, {
      method: 'POST',
      body,
    }),
  );
}

/** 停用/启用，也用来改标题和周期。停用会取消这条计划相关的待发送提醒。 */
export function useUpdateMaintenancePlan() {
  return useAssetMutation<
    {
      planId: string;
      body: {
        title?: string;
        frequencyDays?: number;
        nextDueDate?: string;
        note?: string | null;
        isEnabled?: boolean;
      };
    },
    Saved
  >(({ planId, body }) =>
    api<Saved>(`/maintenance-plans/${planId}`, { method: 'PATCH', body }),
  );
}

// ---- 维护耗材 ---------------------------------------------------------------

export function useUpsertMaintenanceConsumable() {
  return useAssetMutation<
    { planId: string; consumableId?: string; inventoryItemId: string; quantity: number },
    MaintenanceConsumable
  >(({ planId, consumableId, inventoryItemId, quantity }) =>
    consumableId
      ? api<MaintenanceConsumable>(`/maintenance-consumables/${consumableId}`, {
          method: 'PATCH',
          body: { inventoryItemId, quantity },
        })
      : api<MaintenanceConsumable>(`/maintenance-plans/${planId}/consumables`, {
          method: 'POST',
          body: { inventoryItemId, quantity },
        }),
  );
}

export function useRemoveMaintenanceConsumable() {
  return useAssetMutation<{ consumableId: string }, Saved>(({ consumableId }) =>
    api<Saved>(`/maintenance-consumables/${consumableId}`, { method: 'DELETE' }),
  );
}

/** 完成维护前看一眼：库存够不够、单位有没有变。没关联耗材时 rows 是空的。 */
export function useMaintenanceConsumablesPreview(planId: string | undefined) {
  return useQuery({
    queryKey: ['maintenance-consumables-preview', planId],
    queryFn: () =>
      api<MaintenanceConsumablesPreview>(`/maintenance-plans/${planId}/consumables-preview`),
    enabled: Boolean(planId),
  });
}

export function useAddMaintenanceShoppingItems() {
  return useAssetMutation<{ planId: string; date: string }, MaintenanceShoppingResult>(
    ({ planId, date }) =>
      api<MaintenanceShoppingResult>(`/maintenance-plans/${planId}/shopping-items`, {
        method: 'POST',
        body: { date },
      }),
    ['shopping'],
  );
}

/**
 * 登记一次维护并推进下次到期日。幂等键由表单一次挂载生成一个：
 * 失败重试要用同一个键，否则重试会记成两次维护、日期推两遍。
 */
export function useCompleteMaintenance() {
  return useAssetMutation<
    {
      planId: string;
      performedAt: string;
      cost: number | null;
      note: string | null;
      consumeInventory: boolean;
      idempotencyKey: string;
    },
    MaintenanceCompletionResult
  >(
    ({ planId, ...body }) =>
      api<MaintenanceCompletionResult>(`/maintenance-plans/${planId}/complete`, {
        method: 'POST',
        body,
      }),
    ['inventory', 'inventory-transactions', 'maintenance-consumables-preview'],
  );
}

// ---- 凭证与资料 -------------------------------------------------------------

export function useCreateAssetDocument() {
  return useAssetMutation<
    { type: AssetDocumentType; title: string; url: string },
    Saved
  >(({ assetId, ...body }) =>
    api<Saved>(`/assets/${assetId}/documents`, { method: 'POST', body }),
  );
}

/** 上传的文件存在私有目录，列表里的 url 恒为 null，要看内容得走 /access。 */
export function useUploadAssetDocument() {
  return useAssetMutation<
    { type: AssetDocumentType; title: string; file: File },
    Saved
  >(({ assetId, type, title, file }) => {
    const form = new FormData();
    form.append('type', type);
    form.append('title', title);
    form.append('file', file);
    return postForm<Saved>(`/assets/${assetId}/documents/upload`, form);
  });
}

export function useRemoveAssetDocument() {
  return useAssetMutation<{ documentId: string }, Saved>(({ documentId }) =>
    api<Saved>(`/asset-documents/${documentId}`, { method: 'DELETE' }),
  );
}
