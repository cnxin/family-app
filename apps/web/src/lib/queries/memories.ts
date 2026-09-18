import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FamilyMemory, FamilyMemoryCategory } from '@family/contracts';
import { api, postForm } from '../api';

export const MEMORY_CATEGORY_LABELS: Record<FamilyMemoryCategory, string> = {
  daily: '日常',
  celebration: '庆祝',
  travel: '出行',
  meal: '聚餐',
  visit: '相聚',
  milestone: '里程碑',
  other: '其他',
};

export const MEMORY_CATEGORY_EMOJI: Record<FamilyMemoryCategory, string> = {
  daily: '🗓️',
  celebration: '🎉',
  travel: '✈️',
  meal: '🍜',
  visit: '🧑‍🤝‍🧑',
  milestone: '⭐',
  other: '📦',
};

export const MEMORY_SOURCE_LABELS: Record<string, string> = {
  calendar: '家庭日历',
  travel: '家庭出行',
  menu: '家庭菜单',
  media: '家庭观影',
  visit: '访客来访',
};

/** 每条回忆最多 6 张照片，后端会卡住第 7 张。 */
export const MEMORY_PHOTO_LIMIT = 6;

/**
 * 照片正文是公开端点 + 签名地址（10 分钟有效），所以 `<img src>` 直接用就行，不用带令牌。
 * 但每次列表响应都会重新签一次，地址每次都不一样，浏览器缓存基本用不上——这是后端的取舍。
 */
export function memoryPhotoSrc(contentUrl: string) {
  return contentUrl.startsWith('http') ? contentUrl : `/api${contentUrl}`;
}

export function memoryDateLabel(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

export function memoryKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function useMemories(input: {
  status: 'active' | 'archived';
  category: FamilyMemoryCategory | 'all';
  q: string;
}) {
  const query = new URLSearchParams({ status: input.status });
  if (input.category !== 'all') query.set('category', input.category);
  if (input.q.trim()) query.set('q', input.q.trim());
  const search = query.toString();
  return useQuery({
    queryKey: ['memories', search],
    queryFn: () => api<FamilyMemory[]>(`/memories?${search}`),
  });
}

function useMemoryMutation<TInput>(run: (input: TInput) => Promise<FamilyMemory>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['memories'] });
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useSaveMemory() {
  return useMemoryMutation<{
    id?: string;
    body: {
      title: string;
      happenedOn: string;
      category: FamilyMemoryCategory;
      story: string | null;
      tags: string[];
    };
    expectedVersion?: number;
    idempotencyKey: string;
  }>(({ id, body, expectedVersion, idempotencyKey }) =>
    id
      ? api<FamilyMemory>(`/memories/${id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion, idempotencyKey },
        })
      : api<FamilyMemory>('/memories', { method: 'POST', body: { ...body, idempotencyKey } }),
  );
}

export function useSetMemoryArchived() {
  return useMemoryMutation<{
    id: string;
    archived: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }>(({ id, archived, expectedVersion, idempotencyKey }) =>
    api<FamilyMemory>(`/memories/${id}/${archived ? 'archive' : 'restore'}`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

/**
 * 上传一张照片。multipart 的文件字段叫 `file`——契约注释里写的是 `photo`，那是笔误，
 * 控制器用的是 `FileInterceptor('file')`，照注释写会拿到 400「没有收到回忆照片」。
 * 上传不改回忆的 version，所以传完不用重新拿版本号。
 */
export function useUploadMemoryPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { memoryId: string; file: File; caption: string; idempotencyKey: string }) => {
      const form = new FormData();
      form.append('file', input.file);
      form.append('caption', input.caption);
      form.append('idempotencyKey', input.idempotencyKey);
      return postForm<{ id: string }>(`/memories/${input.memoryId}/photos`, form);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['memories'] });
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
