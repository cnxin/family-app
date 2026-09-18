import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KnowledgeArticle,
  KnowledgeArticleCategory,
  KnowledgeArticleRevision,
  KnowledgeRevisionChangeType,
} from '@family/contracts';
import { api } from '../api';

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeArticleCategory, string> = {
  procedure: '家庭流程',
  appliance: '设备说明',
  contact: '常用联系',
  home: '居家资料',
  other: '其他',
};

export const KNOWLEDGE_CHANGE_LABELS: Record<KnowledgeRevisionChangeType, string> = {
  create: '创建',
  update: '编辑',
  archive: '归档',
  restore: '恢复',
  restore_revision: '还原历史',
};

/** 后端按「置顶优先 + 最近更新」排好序，最多 100 条，没有分页。 */
export function useKnowledgeArticles(input: {
  status: 'active' | 'archived' | 'all';
  category: KnowledgeArticleCategory | 'all';
  q: string;
}) {
  const query = new URLSearchParams({ status: input.status });
  if (input.category !== 'all') query.set('category', input.category);
  if (input.q.trim()) query.set('q', input.q.trim());
  const search = query.toString();
  return useQuery({
    queryKey: ['knowledge', search],
    queryFn: () => api<KnowledgeArticle[]>(`/knowledge-articles?${search}`),
  });
}

export function useKnowledgeRevisions(articleId: string | undefined) {
  return useQuery({
    queryKey: ['knowledge-revisions', articleId],
    queryFn: () => api<KnowledgeArticleRevision[]>(`/knowledge-articles/${articleId}/revisions`),
    enabled: Boolean(articleId),
  });
}

function useKnowledgeMutation<TInput>(run: (input: TInput) => Promise<KnowledgeArticle>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (article) => {
      void client.invalidateQueries({ queryKey: ['knowledge'] });
      void client.invalidateQueries({ queryKey: ['knowledge-revisions', article.id] });
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export interface KnowledgeDraftBody {
  title: string;
  category: KnowledgeArticleCategory;
  summary: string | null;
  content: string;
  referenceUrl: string | null;
  tags: string[];
  isPinned?: boolean;
}

/**
 * 写操作都带幂等键和 expectedVersion。幂等键存在版本行上（家庭级唯一）：
 * 同键同内容直接回原文章不涨版本，同键不同内容 409。
 */
export function useSaveKnowledgeArticle() {
  return useKnowledgeMutation<{
    id?: string;
    body: KnowledgeDraftBody;
    expectedVersion?: number;
    idempotencyKey: string;
  }>(({ id, body, expectedVersion, idempotencyKey }) =>
    id
      ? api<KnowledgeArticle>(`/knowledge-articles/${id}`, {
          method: 'PATCH',
          body: { ...body, expectedVersion, idempotencyKey },
        })
      : api<KnowledgeArticle>('/knowledge-articles', {
          method: 'POST',
          body: { ...body, idempotencyKey },
        }),
  );
}

/** 归档 / 恢复：归档会顺带取消置顶，恢复不会自动再置顶回去。 */
export function useSetKnowledgeArchived() {
  return useKnowledgeMutation<{
    id: string;
    archived: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }>(({ id, archived, expectedVersion, idempotencyKey }) =>
    api<KnowledgeArticle>(`/knowledge-articles/${id}/${archived ? 'archive' : 'restore'}`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

/** 还原到某个历史版本：只回搬正文那几项，置顶和归档状态不跟着回去。 */
export function useRestoreKnowledgeRevision() {
  return useKnowledgeMutation<{
    id: string;
    version: number;
    expectedVersion: number;
    idempotencyKey: string;
  }>(({ id, version, expectedVersion, idempotencyKey }) =>
    api<KnowledgeArticle>(`/knowledge-articles/${id}/revisions/${version}/restore`, {
      method: 'POST',
      body: { expectedVersion, idempotencyKey },
    }),
  );
}

export function knowledgeKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
