import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  removedResponse,
  uuid,
} from './common';
import { ingredientSchema, numericString } from './dishes';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/inventory/*（库存项、批次、不可变流水、菜单/购物联动）
// 与 docs/m6-inventory-shopping-acceptance.md、docs/m7-food-batches-smart-menu-acceptance.md

export const INVENTORY_CATEGORIES = [
  '调料',
  '主食',
  '饮料',
  '零食',
  '日用品',
  '药品',
  '其他',
] as const;
export const inventoryCategory = z.enum(INVENTORY_CATEGORIES);
export type InventoryCategory = z.infer<typeof inventoryCategory>;

export const INVENTORY_TRANSACTION_TYPES = [
  'receipt',
  'consumption',
  'adjustment',
  'reversal',
] as const;
export const inventoryTransactionType = z.enum(INVENTORY_TRANSACTION_TYPES);
export type InventoryTransactionType = z.infer<typeof inventoryTransactionType>;

export const INVENTORY_TRANSACTION_SOURCE_TYPES = [
  'shopping_item',
  'menu',
  'maintenance_record',
  'inventory_item',
  'manual_adjustment',
  'inventory_transaction',
] as const;
export const inventoryTransactionSourceType = z.enum(
  INVENTORY_TRANSACTION_SOURCE_TYPES,
);

export const INVENTORY_BATCH_STATUSES = [
  'fresh',
  'expiring',
  'expired',
  'undated',
  'consumed',
] as const;
export const inventoryBatchStatus = z.enum(INVENTORY_BATCH_STATUSES);
export type InventoryBatchStatus = z.infer<typeof inventoryBatchStatus>;

export const INVENTORY_BATCH_SOURCE_TYPES = ['manual', 'shopping_item'] as const;

// ---- 库存项 -----------------------------------------------------------------

export const inventoryBatchSummarySchema = z.object({
  trackedQuantity: z.number(),
  untrackedQuantity: z.number(),
  activeBatchCount: z.number().int(),
  earliestExpiresOn: dateOnly.nullable(),
  expiringCount: z.number().int(),
  expiredCount: z.number().int(),
});
export type InventoryBatchSummary = z.infer<typeof inventoryBatchSummarySchema>;

/** 库存项实体；`batchSummary` 只在 GET /inventory 列表里附带。 */
export const inventoryItemSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    ingredientId: uuid.nullable(),
    ingredient: ingredientSchema.nullish(),
    name: z.string(),
    category: inventoryCategory,
    quantity: numericString,
    unit: z.string(),
    lowStockThreshold: numericString,
    restockQuantity: numericString,
    batchSummary: inventoryBatchSummarySchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const inventoryItemWithSummarySchema = inventoryItemSchema.extend({
  batchSummary: inventoryBatchSummarySchema,
});

export const createInventoryItemBody = z.object({
  ingredientId: uuid.nullish(),
  name: z.string().min(1).max(80),
  category: inventoryCategory,
  quantity: z.number().min(0),
  unit: z.string().min(1).max(16),
  lowStockThreshold: z.number().min(0),
  restockQuantity: z.number().min(0.01),
});
export type CreateInventoryItemBody = z.infer<typeof createInventoryItemBody>;

export const updateInventoryItemBody = createInventoryItemBody
  .partial()
  .extend({ idempotencyKey: z.string().max(120).optional() });
export type UpdateInventoryItemBody = z.infer<typeof updateInventoryItemBody>;

// ---- 流水 -------------------------------------------------------------------

/** 流水实体（写操作直接回传 save 结果）。 */
export const inventoryTransactionRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    inventoryItemId: uuid,
    inventoryItem: inventoryItemSchema.optional(),
    operationId: uuid,
    type: inventoryTransactionType,
    quantityBefore: numericString,
    delta: numericString,
    quantityAfter: numericString,
    unit: z.string(),
    actorId: uuid,
    actor: memberSchema.optional(),
    actorName: z.string(),
    sourceType: inventoryTransactionSourceType,
    sourceId: uuid,
    reversesTransactionId: uuid.nullable(),
    createdAt: isoDateTime,
  });
export type InventoryTransactionRecord = z.infer<
  typeof inventoryTransactionRecordSchema
>;

/** 流水列表行：实体 + 撤销状态 + 可撤销判断。 */
export const inventoryTransactionSchema = inventoryTransactionRecordSchema.extend({
  inventoryItem: inventoryItemSchema,
  reversedAt: nullableDateTime,
  reversalTransactionId: uuid.nullable(),
  canReverse: z.boolean(),
});
export type InventoryTransaction = z.infer<typeof inventoryTransactionSchema>;

/** 确认入库/扣库/撤销的统一结果。 */
export const inventoryActionResultSchema = z.object({
  alreadyConfirmed: z.boolean().optional(),
  alreadyReversed: z.boolean().optional(),
  transactions: z.array(inventoryTransactionRecordSchema),
});
export type InventoryActionResult = z.infer<typeof inventoryActionResultSchema>;

export const inventoryTransactionsQuery = z.object({
  inventoryItemId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- 批次 -------------------------------------------------------------------

export const inventoryBatchSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    inventoryItemId: uuid,
    inventoryItem: inventoryItemSchema,
    quantity: numericString,
    receivedOn: dateOnly,
    productionDate: dateOnly.nullable(),
    expiresOn: dateOnly.nullable(),
    openedOn: dateOnly.nullable(),
    sourceType: z.enum(INVENTORY_BATCH_SOURCE_TYPES),
    sourceId: uuid,
    version: z.number().int(),
    createdById: uuid,
    createdBy: memberSchema,
    status: inventoryBatchStatus,
    daysRemaining: z.number().int().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type InventoryBatch = z.infer<typeof inventoryBatchSchema>;

export const inventoryBatchesQuery = z.object({
  inventoryItemId: uuid.optional(),
  status: z.enum(['all', 'active', 'expiring', 'expired']).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const batchDatesInput = z.object({
  receivedOn: z.string().max(10).nullish(),
  productionDate: z.string().max(10).nullish(),
  expiresOn: z.string().max(10).nullish(),
  openedOn: z.string().max(10).nullish(),
});
export type BatchDatesInput = z.infer<typeof batchDatesInput>;

export const createInventoryBatchBody = batchDatesInput.extend({
  inventoryItemId: uuid,
  quantity: z.number().min(0.01),
  idempotencyKey: z.string().min(1).max(120),
});
export type CreateInventoryBatchBody = z.infer<typeof createInventoryBatchBody>;

export const updateInventoryBatchBody = batchDatesInput.extend({
  expectedVersion: z.number().int().min(1),
});
export type UpdateInventoryBatchBody = z.infer<typeof updateInventoryBatchBody>;

// ---- 购物入库预览 / 菜单扣库预览 ---------------------------------------------

const inventoryCandidateSchema = z.object({
  id: uuid,
  name: z.string(),
  ingredientId: uuid.nullable(),
  quantity: numericString,
  unit: z.string(),
});

/** 已确认流水的摘要（preview 里的 confirmation / transactions）。 */
export const inventoryConfirmationSummarySchema = z
  .object({
    id: uuid,
    operationId: uuid,
    inventoryItemId: uuid,
    inventoryItemName: z.string(),
    quantityBefore: numericString,
    delta: numericString,
    quantityAfter: numericString,
    unit: z.string(),
    actorName: z.string(),
    createdAt: isoDateTime,
    reversedAt: nullableDateTime,
    reversalTransactionId: uuid.nullable(),
  });

export const shoppingInventoryPreviewSchema = z
  .object({
    shoppingItem: z.object({
      id: uuid,
      name: z.string(),
      ingredientId: uuid.nullable(),
      quantity: numericString.nullable(),
      unit: z.string().nullable(),
      checked: z.boolean(),
    }),
    candidates: z.array(inventoryCandidateSchema),
    selectedInventoryItem: inventoryCandidateSchema.nullable(),
    quantityBefore: z.number().nullable(),
    quantityAfter: z.number().nullable(),
    canConfirm: z.boolean(),
    confirmation: inventoryConfirmationSummarySchema.nullable(),
  });
export type ShoppingInventoryPreview = z.infer<
  typeof shoppingInventoryPreviewSchema
>;

export const batchAllocationSchema = z.object({
  batchId: uuid,
  receivedOn: dateOnly,
  productionDate: dateOnly.nullable(),
  expiresOn: dateOnly.nullable(),
  openedOn: dateOnly.nullable(),
  status: inventoryBatchStatus,
  quantityBefore: z.number(),
  quantity: z.number(),
  quantityAfter: z.number(),
});

export const MENU_PREVIEW_ROW_STATUSES = [
  'ready',
  'missing_inventory',
  'unit_mismatch',
  'insufficient',
] as const;

export const menuInventoryPreviewRowSchema = z
  .object({
    ingredientId: uuid,
    ingredientName: z.string(),
    unit: z.string(),
    quantity: z.number(),
    status: z.enum(MENU_PREVIEW_ROW_STATUSES),
    inventoryItemId: uuid.nullable(),
    inventoryItemName: z.string().nullable(),
    quantityBefore: z.number().nullable(),
    quantityAfter: z.number().nullable(),
    availableUnits: z.array(z.string()),
    batchAllocations: z.array(batchAllocationSchema),
    untrackedQuantity: z.number(),
  });

export const menuInventoryPreviewSchema = z
  .object({
    menuId: uuid,
    menuStatus: z.enum(['open', 'done']),
    confirmed: z.boolean(),
    reversed: z.boolean(),
    canConfirm: z.boolean(),
    rows: z.array(menuInventoryPreviewRowSchema),
    transactions: z.array(inventoryConfirmationSummarySchema),
  });
export type MenuInventoryPreview = z.infer<typeof menuInventoryPreviewSchema>;

export const confirmShoppingReceiptBody = z.object({
  inventoryItemId: uuid.optional(),
  batch: batchDatesInput.optional(),
});

export const inventory = {
  list: defineEndpoint({
    method: 'GET',
    path: '/inventory',
    summary: '库存项列表（含批次汇总）',
    response: z.array(inventoryItemWithSummarySchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/inventory-items',
    summary: '新建库存项（初始量记一条 receipt 流水）',
    body: createInventoryItemBody,
    response: inventoryItemSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/inventory-items/:id',
    summary: '修改库存项；改 quantity 时记 adjustment 流水，需要 idempotencyKey',
    params: idParams,
    body: updateInventoryItemBody,
    response: inventoryItemSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/inventory-items/:id',
    summary: '删除库存项（被耗材或购物项引用时拒绝）',
    params: idParams,
    response: removedResponse,
  }),
  transactions: defineEndpoint({
    method: 'GET',
    path: '/inventory-transactions',
    summary: '不可变流水（最新在前，含撤销状态）',
    query: inventoryTransactionsQuery,
    response: z.array(inventoryTransactionSchema),
  }),
  batches: defineEndpoint({
    method: 'GET',
    path: '/inventory-batches',
    summary: '食材批次（按状态过滤，含剩余天数）',
    query: inventoryBatchesQuery,
    response: z.array(inventoryBatchSchema),
  }),
  createBatch: defineEndpoint({
    method: 'POST',
    path: '/inventory-batches',
    summary: '手工登记批次（同时增加库存量）',
    body: createInventoryBatchBody,
    response: inventoryBatchSchema,
  }),
  updateBatch: defineEndpoint({
    method: 'PATCH',
    path: '/inventory-batches/:id',
    summary: '修改批次日期（乐观锁 expectedVersion）',
    params: idParams,
    body: updateInventoryBatchBody,
    response: inventoryBatchSchema,
  }),
  shoppingPreview: defineEndpoint({
    method: 'GET',
    path: '/shopping-items/:id/inventory-preview',
    summary: '购物项入库预览：候选库存项与预计变化',
    params: idParams,
    query: z.object({ inventoryItemId: uuid.optional() }),
    response: shoppingInventoryPreviewSchema,
  }),
  confirmShoppingReceipt: defineEndpoint({
    method: 'POST',
    path: '/shopping-items/:id/confirm-stock',
    summary: '确认购物项入库（幂等）',
    params: idParams,
    body: confirmShoppingReceiptBody,
    response: inventoryActionResultSchema,
  }),
  menuPreview: defineEndpoint({
    method: 'GET',
    path: '/menus/:id/inventory-preview',
    summary: '菜单扣库预览：逐食材可行性与批次分配',
    params: idParams,
    response: menuInventoryPreviewSchema,
  }),
  confirmMenuConsumption: defineEndpoint({
    method: 'POST',
    path: '/menus/:id/confirm-consumption',
    summary: '确认菜单扣库（幂等，菜单需已完成）',
    params: idParams,
    response: inventoryActionResultSchema,
  }),
  reverse: defineEndpoint({
    method: 'POST',
    path: '/inventory-transactions/:id/reverse',
    summary: '按操作整体撤销流水（幂等）',
    params: idParams,
    response: inventoryActionResultSchema,
  }),
};
