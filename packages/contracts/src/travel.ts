import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateTime,
  memberBriefSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/travel/travel.module.ts 与 docs/m10-travel-acceptance.md
//
// 所有写操作都带 idempotencyKey + expectedVersion（乐观锁），并且都回传整份行程（detail()）
// 或整份模板（templateDetail()），响应经 planResponse() / templateResponse() 逐字段挑选，
// 所以 21 个端点只有两种响应形状。planResponse 里的 items 已过滤掉 archivedAt 非空的项。

export const TRAVEL_PLAN_STATUSES = ['planned', 'completed', 'cancelled'] as const;
export const travelPlanStatus = z.enum(TRAVEL_PLAN_STATUSES);
export type TravelPlanStatus = z.infer<typeof travelPlanStatus>;

export const TRAVEL_CHECKLIST_STATUSES = ['pending', 'completed', 'skipped'] as const;
export const travelChecklistStatus = z.enum(TRAVEL_CHECKLIST_STATUSES);
export type TravelChecklistStatus = z.infer<typeof travelChecklistStatus>;

export const TRAVEL_CHECKLIST_CATEGORIES = [
  'documents',
  'clothing',
  'toiletries',
  'electronics',
  'supplies',
  'other',
] as const;
export const travelChecklistCategory = z.enum(TRAVEL_CHECKLIST_CATEGORIES);
export type TravelChecklistCategory = z.infer<typeof travelChecklistCategory>;

const idempotencyKey = z.string().min(1).max(180);
const expectedVersion = z.number().int().min(1);

// ---- 响应 -------------------------------------------------------------------

export const travelChecklistItemSchema = z.object({
  id: uuid,
  title: z.string(),
  category: travelChecklistCategory,
  quantity: z.number().int(),
  note: z.string().nullable(),
  sortOrder: z.number().int(),
  status: travelChecklistStatus,
  version: z.number().int(),
  assignedMember: memberBriefSchema.nullable(),
  completedBy: memberBriefSchema.nullable(),
  completedAt: nullableDateTime,
  fromTemplate: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TravelChecklistItem = z.infer<typeof travelChecklistItemSchema>;

/** planResponse()：列表不查已应用模板，appliedTemplateIds 为空数组；详情/写操作会带。 */
export const travelPlanSchema = z.object({
  id: uuid,
  title: z.string(),
  destination: z.string().nullable(),
  startDate: dateOnly,
  endDate: dateOnly,
  note: z.string().nullable(),
  status: travelPlanStatus,
  version: z.number().int(),
  createdBy: memberBriefSchema,
  updatedBy: memberBriefSchema,
  completedBy: memberBriefSchema.nullable(),
  completedAt: nullableDateTime,
  archivedAt: nullableDateTime,
  items: z.array(travelChecklistItemSchema),
  counts: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    completed: z.number().int(),
    skipped: z.number().int(),
  }),
  appliedTemplateIds: z.array(uuid),
  canManage: z.boolean(),
  canEditChecklist: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TravelPlan = z.infer<typeof travelPlanSchema>;

export const travelTemplateItemSchema = z.object({
  id: uuid,
  title: z.string(),
  category: travelChecklistCategory,
  quantity: z.number().int(),
  sortOrder: z.number().int(),
});
export type TravelTemplateItem = z.infer<typeof travelTemplateItemSchema>;

/** templateResponse() */
export const travelPackingTemplateSchema = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  items: z.array(travelTemplateItemSchema),
  createdBy: memberBriefSchema,
  archivedAt: nullableDateTime,
  canManage: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type TravelPackingTemplate = z.infer<typeof travelPackingTemplateSchema>;

// ---- 请求 -------------------------------------------------------------------

export const travelPlanListQuery = z.object({
  status: z.enum(['active', 'completed', 'cancelled', 'archived', 'all']).optional(),
});
export const travelTemplateListQuery = z.object({
  status: z.enum(['active', 'archived', 'all']).optional(),
});

export const createTravelPlanBody = z.object({
  title: z.string().min(1).max(120),
  destination: z.string().max(120).nullish(),
  startDate: dateOnly,
  endDate: dateOnly,
  note: z.string().max(1000).nullish(),
  idempotencyKey,
});
export const updateTravelPlanBody = createTravelPlanBody
  .omit({ idempotencyKey: true })
  .partial()
  .extend({ expectedVersion, idempotencyKey });

/** 完成 / 重开 / 取消 / 归档 / 恢复，以及清单项和模板的同类操作共用。 */
export const travelVersionOperationBody = z.object({ expectedVersion, idempotencyKey });
export type TravelVersionOperationBody = z.infer<typeof travelVersionOperationBody>;

export const createTravelItemBody = z.object({
  title: z.string().min(1).max(120),
  category: travelChecklistCategory,
  quantity: z.number().int().min(1).max(99).optional(),
  note: z.string().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  assignedMemberId: uuid.nullish(),
  idempotencyKey,
});
export const updateTravelItemBody = createTravelItemBody
  .omit({ idempotencyKey: true })
  .partial()
  .extend({ expectedVersion, idempotencyKey });

export const travelTemplateItemInput = z.object({
  title: z.string().min(1).max(120),
  category: travelChecklistCategory,
  quantity: z.number().int().min(1).max(99).optional(),
});
export const createTravelTemplateBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  items: z.array(travelTemplateItemInput).min(1).max(100),
  idempotencyKey,
});
export const updateTravelTemplateBody = createTravelTemplateBody
  .omit({ idempotencyKey: true })
  .partial()
  .extend({ expectedVersion, idempotencyKey });

export const applyTravelTemplateBody = z.object({
  expectedPlanVersion: expectedVersion,
  expectedTemplateVersion: expectedVersion,
  idempotencyKey,
});

export const travelItemParams = z.object({ planId: uuid, itemId: uuid });
export const travelApplyParams = z.object({ planId: uuid, templateId: uuid });

// ---- 端点 -------------------------------------------------------------------

const planOperation = (path: string, summary: string) =>
  defineEndpoint({
    method: 'POST',
    path,
    summary,
    params: idParams,
    body: travelVersionOperationBody,
    response: travelPlanSchema,
  });

const itemOperation = (path: string, summary: string) =>
  defineEndpoint({
    method: 'POST',
    path,
    summary,
    params: travelItemParams,
    body: travelVersionOperationBody,
    response: travelPlanSchema,
  });

const templateOperation = (path: string, summary: string) =>
  defineEndpoint({
    method: 'POST',
    path,
    summary,
    params: idParams,
    body: travelVersionOperationBody,
    response: travelPackingTemplateSchema,
  });

export const travel = {
  plans: defineEndpoint({
    method: 'GET',
    path: '/travel-plans',
    summary: '出行计划列表（默认只看计划中的；appliedTemplateIds 恒为空）',
    query: travelPlanListQuery,
    response: z.array(travelPlanSchema),
  }),
  plan: defineEndpoint({
    method: 'GET',
    path: '/travel-plans/:id',
    summary: '出行计划详情（含已应用模板）',
    params: idParams,
    response: travelPlanSchema,
  }),
  createPlan: defineEndpoint({
    method: 'POST',
    path: '/travel-plans',
    summary: '创建出行计划（幂等）',
    body: createTravelPlanBody,
    response: travelPlanSchema,
  }),
  updatePlan: defineEndpoint({
    method: 'PATCH',
    path: '/travel-plans/:id',
    summary: '修改出行计划基本信息（乐观锁 + 幂等）',
    params: idParams,
    body: updateTravelPlanBody,
    response: travelPlanSchema,
  }),
  completePlan: planOperation('/travel-plans/:id/complete', '完成行程（要求没有待处理清单项）'),
  reopenPlan: planOperation('/travel-plans/:id/reopen', '重新打开已完成或已取消的行程'),
  cancelPlan: planOperation('/travel-plans/:id/cancel', '取消行程（同时取消关联提醒）'),
  archivePlan: planOperation('/travel-plans/:id/archive', '归档行程'),
  restorePlan: planOperation('/travel-plans/:id/restore', '恢复已归档行程'),
  createItem: defineEndpoint({
    method: 'POST',
    path: '/travel-plans/:planId/items',
    summary: '新增清单项（幂等，回传整份行程）',
    params: z.object({ planId: uuid }),
    body: createTravelItemBody,
    response: travelPlanSchema,
  }),
  updateItem: defineEndpoint({
    method: 'PATCH',
    path: '/travel-plans/:planId/items/:itemId',
    summary: '修改清单项（乐观锁 + 幂等，回传整份行程）',
    params: travelItemParams,
    body: updateTravelItemBody,
    response: travelPlanSchema,
  }),
  completeItem: itemOperation('/travel-plans/:planId/items/:itemId/complete', '勾选清单项'),
  restoreItem: itemOperation('/travel-plans/:planId/items/:itemId/restore', '清单项恢复为待处理'),
  skipItem: itemOperation('/travel-plans/:planId/items/:itemId/skip', '跳过清单项'),
  archiveItem: itemOperation('/travel-plans/:planId/items/:itemId/archive', '移除清单项（仅创建者或管理员）'),
  templates: defineEndpoint({
    method: 'GET',
    path: '/travel-templates',
    summary: '打包模板列表（默认只看未归档）',
    query: travelTemplateListQuery,
    response: z.array(travelPackingTemplateSchema),
  }),
  createTemplate: defineEndpoint({
    method: 'POST',
    path: '/travel-templates',
    summary: '创建打包模板（幂等）',
    body: createTravelTemplateBody,
    response: travelPackingTemplateSchema,
  }),
  updateTemplate: defineEndpoint({
    method: 'PATCH',
    path: '/travel-templates/:id',
    summary: '修改打包模板（传 items 则整体替换；乐观锁 + 幂等）',
    params: idParams,
    body: updateTravelTemplateBody,
    response: travelPackingTemplateSchema,
  }),
  archiveTemplate: templateOperation('/travel-templates/:id/archive', '归档打包模板'),
  restoreTemplate: templateOperation('/travel-templates/:id/restore', '恢复已归档模板'),
  applyTemplate: defineEndpoint({
    method: 'POST',
    path: '/travel-plans/:planId/templates/:templateId/apply',
    summary: '把模板项追加进行程清单（每个模板对同一行程只能应用一次）',
    params: travelApplyParams,
    body: applyTravelTemplateBody,
    response: travelPlanSchema,
  }),
};
