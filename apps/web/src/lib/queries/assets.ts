import { invalidateModules } from './modules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetCategory,
  AssetDocumentAccess,
  AssetDocumentType,
  AssetRenewalIntervalMonths,
  AssetStatus,
  HomeAsset,
} from '@family/contracts';
import { api } from '../api';

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  appliance: '家电',
  furniture: '家具',
  electronics: '数码',
  tool: '工具',
  subscription: '订阅',
  other: '其他',
};

/** 保修只对这三类生效（后端也是这么判的），家具和其他两类既没保修也没续费。 */
export const WARRANTY_CATEGORIES: AssetCategory[] = ['appliance', 'electronics', 'tool'];

export const RENEWAL_INTERVAL_LABELS: Record<AssetRenewalIntervalMonths, string> = {
  1: '每月',
  3: '每季度',
  6: '每半年',
  12: '每年',
};

/**
 * 日期差一律锚在本地中午：`new Date('2026-03-05')` 是 UTC 午夜，
 * 在东八区会被当成前一天的 8 点，「今天到期」就会算成「逾期 1 天」。
 */
export function daysUntil(date: string) {
  const target = new Date(`${date}T12:00:00`).getTime();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

export function assetDateLabel(date: string | null) {
  if (!date) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

/** 后端一次最多回 200 条、并且已经按「使用中优先 + 最近更新」排好序，前端不要重排。 */
export function useAssets(status: 'active' | 'retired' | 'all' = 'all') {
  return useQuery({
    queryKey: ['assets', status],
    queryFn: () => api<HomeAsset[]>(`/assets?status=${status}`),
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => api<HomeAsset>(`/assets/${id}`),
    enabled: Boolean(id),
  });
}

export function invalidateAssets(client: ReturnType<typeof useQueryClient>, id?: string) {
  void invalidateModules(client);
  void client.invalidateQueries({ queryKey: ['assets'] });
  void client.invalidateQueries({ queryKey: ['asset', id] });
  // 资产和维护计划都是提醒的来源，停用会连带取消待发送的提醒
  void client.invalidateQueries({ queryKey: ['reminder-sources'] });
  void client.invalidateQueries({ queryKey: ['reminders'] });
}

export interface AssetBody {
  name?: string;
  category?: AssetCategory;
  location?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  warrantyExpiresOn?: string | null;
  renewsOn?: string | null;
  renewalIntervalMonths?: AssetRenewalIntervalMonths | null;
  status?: AssetStatus;
  note?: string | null;
}

export function useUpsertAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; body: AssetBody }) =>
      input.id
        ? api<HomeAsset>(`/assets/${input.id}`, { method: 'PATCH', body: input.body })
        : api<HomeAsset>('/assets', { method: 'POST', body: input.body }),
    onSuccess: (saved) => invalidateAssets(client, saved.id),
  });
}

/** 订阅按周期推进下次续费日；不传 renewedOn 就按今天算。 */
export function useRenewAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; renewedOn?: string }) =>
      api<HomeAsset>(`/assets/${input.id}/renew`, {
        method: 'POST',
        body: input.renewedOn ? { renewedOn: input.renewedOn } : {},
      }),
    onSuccess: (saved) => invalidateAssets(client, saved.id),
  });
}

export const ASSET_DOCUMENT_LABELS: Record<AssetDocumentType, string> = {
  receipt: '购买凭证',
  manual: '说明资料',
  warranty: '保修材料',
  other: '其他资料',
};

/**
 * 换一个能打开的地址：外链原样回来，上传的私有文件给一条 60 秒的签名地址。
 * 所以列表里的 `url` 对私有文件恒为 null，不能直接拿去打开，签名地址也不能缓存。
 */
export function useAssetDocumentAccess() {
  return useMutation({
    mutationFn: (id: string) => api<AssetDocumentAccess>(`/asset-documents/${id}/access`),
  });
}
