import { z } from 'zod';
import {
  idParams,
  isoDateTime,
  memberBriefSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/knowledge/knowledge.module.ts 与 docs/m11-knowledge-acceptance.md
//
// 所有响应经 articleResponse() / revisionResponse() 逐字段挑选；每次写操作都落一条 revision，
// 幂等键也存在 revision 上。写端点最后都 return this.detail()，只有两种响应形状。

export const KNOWLEDGE_ARTICLE_CATEGORIES = [
  'procedure',
  'appliance',
  'contact',
  'home',
  'other',
] as const;
export const knowledgeArticleCategory = z.enum(KNOWLEDGE_ARTICLE_CATEGORIES);
export type KnowledgeArticleCategory = z.infer<typeof knowledgeArticleCategory>;

export const KNOWLEDGE_REVISION_CHANGE_TYPES = [
  'create',
  'update',
  'archive',
  'restore',
  'restore_revision',
] as const;
export const knowledgeRevisionChangeType = z.enum(KNOWLEDGE_REVISION_CHANGE_TYPES);
export type KnowledgeRevisionChangeType = z.infer<typeof knowledgeRevisionChangeType>;

const idempotencyKey = z.string().min(1).max(180);
const expectedVersion = z.number().int().min(1);
const tags = z.array(z.string().max(24)).max(8);

// ---- 响应 -------------------------------------------------------------------

export const knowledgeArticleSchema = z.object({
  id: uuid,
  title: z.string(),
  category: knowledgeArticleCategory,
  summary: z.string().nullable(),
  content: z.string(),
  referenceUrl: z.string().nullable(),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  version: z.number().int(),
  createdBy: memberBriefSchema,
  updatedBy: memberBriefSchema,
  archivedAt: nullableDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  canEdit: z.boolean(),
  canPin: z.boolean(),
});
export type KnowledgeArticle = z.infer<typeof knowledgeArticleSchema>;

/** revisionResponse()：changedBy.name 取的是写入时快照的 changedByName。 */
export const knowledgeArticleRevisionSchema = z.object({
  id: uuid,
  version: z.number().int(),
  changeType: knowledgeRevisionChangeType,
  title: z.string(),
  category: knowledgeArticleCategory,
  summary: z.string().nullable(),
  content: z.string(),
  referenceUrl: z.string().nullable(),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  archivedAt: nullableDateTime,
  changedBy: memberBriefSchema,
  createdAt: isoDateTime,
});
export type KnowledgeArticleRevision = z.infer<typeof knowledgeArticleRevisionSchema>;

// ---- 请求 -------------------------------------------------------------------

export const knowledgeListQuery = z.object({
  status: z.enum(['active', 'archived', 'all']).optional(),
  category: knowledgeArticleCategory.optional(),
  q: z.string().max(80).optional(),
  tag: z.string().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const createKnowledgeArticleBody = z.object({
  title: z.string().min(1).max(120),
  category: knowledgeArticleCategory,
  summary: z.string().max(500).nullish(),
  content: z.string().min(1).max(20_000),
  referenceUrl: z.string().url().max(2000).nullish(),
  tags: tags.optional(),
  isPinned: z.boolean().optional(),
  idempotencyKey,
});
export const updateKnowledgeArticleBody = createKnowledgeArticleBody
  .omit({ idempotencyKey: true })
  .partial()
  .extend({ expectedVersion, idempotencyKey });

export const knowledgeVersionOperationBody = z.object({ expectedVersion, idempotencyKey });
export const knowledgeRevisionParams = idParams.extend({
  version: z.coerce.number().int().min(1),
});

// ---- 端点 -------------------------------------------------------------------

export const knowledge = {
  list: defineEndpoint({
    method: 'GET',
    path: '/knowledge-articles',
    summary: '知识文章列表（置顶优先；支持分类、标签、全文筛选）',
    query: knowledgeListQuery,
    response: z.array(knowledgeArticleSchema),
  }),
  revisions: defineEndpoint({
    method: 'GET',
    path: '/knowledge-articles/:id/revisions',
    summary: '文章历史版本（新版本在前，最多 100 条）',
    params: idParams,
    response: z.array(knowledgeArticleRevisionSchema),
  }),
  detail: defineEndpoint({
    method: 'GET',
    path: '/knowledge-articles/:id',
    summary: '文章详情',
    params: idParams,
    response: knowledgeArticleSchema,
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/knowledge-articles',
    summary: '创建文章（幂等；置顶需管理员）',
    body: createKnowledgeArticleBody,
    response: knowledgeArticleSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/knowledge-articles/:id',
    summary: '修改文章（乐观锁 + 幂等，落一条 revision）',
    params: idParams,
    body: updateKnowledgeArticleBody,
    response: knowledgeArticleSchema,
  }),
  archive: defineEndpoint({
    method: 'POST',
    path: '/knowledge-articles/:id/archive',
    summary: '归档文章（同时取消置顶）',
    params: idParams,
    body: knowledgeVersionOperationBody,
    response: knowledgeArticleSchema,
  }),
  restore: defineEndpoint({
    method: 'POST',
    path: '/knowledge-articles/:id/restore',
    summary: '恢复已归档文章',
    params: idParams,
    body: knowledgeVersionOperationBody,
    response: knowledgeArticleSchema,
  }),
  restoreRevision: defineEndpoint({
    method: 'POST',
    path: '/knowledge-articles/:id/revisions/:version/restore',
    summary: '把文章内容还原到某个历史版本（产生新版本）',
    params: knowledgeRevisionParams,
    body: knowledgeVersionOperationBody,
    response: knowledgeArticleSchema,
  }),
};
