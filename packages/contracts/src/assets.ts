import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  removedResponse,
  uuid,
} from './common';
import { numericString } from './dishes';
import { inventoryItemSchema, inventoryTransactionRecordSchema } from './inventory';
import { shoppingItemRecordSchema } from './shopping';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/assets/assets.module.ts 与 docs/m5-home-assets-acceptance.md
//
// 这个域 present() 是 `{ ...asset }` 展开实体再补字段，所以响应形状由加载路径决定，按端点列出：
// - 资产五个端点（list/get/create/update/renew）：requireAsset()
//   relations { documents, maintenancePlans: { consumables: { inventoryItem } }, maintenanceRecords }
//   显式关系之下各再带一层 eager：documents.createdBy、maintenancePlans.createdBy / .asset、
//   consumables.createdBy、inventoryItem.ingredient、maintenanceRecords.performedBy 都在；
//   maintenancePlans[].asset 里再深一层的 createdBy 不在。
// - POST 资料（链接/上传）：presentDocument(save()) → createdBy 缺席。
// - 新建/修改维护计划：findOneByOrFail → 根级 eager（asset、createdBy）在，consumables 不在。
// - 新建/修改耗材：findOneOrFail({ relations: { inventoryItem } }) → inventoryItem、createdBy 在，plan 不在。
// - 完成维护：record / plan 都是 findOneByOrFail，transactions 是 find() → 关系只到根级 eager。

export const ASSET_CATEGORIES = [
  'appliance',
  'furniture',
  'electronics',
  'tool',
  'subscription',
  'other',
] as const;
export const assetCategory = z.enum(ASSET_CATEGORIES);
export type AssetCategory = z.infer<typeof assetCategory>;

export const ASSET_RENEWAL_INTERVAL_MONTHS = [1, 3, 6, 12] as const;
export const assetRenewalIntervalMonths = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6),
  z.literal(12),
]);
export type AssetRenewalIntervalMonths = z.infer<typeof assetRenewalIntervalMonths>;

export const ASSET_STATUSES = ['active', 'retired'] as const;
export const assetStatus = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof assetStatus>;

export const ASSET_DOCUMENT_TYPES = ['receipt', 'manual', 'warranty', 'other'] as const;
export const assetDocumentType = z.enum(ASSET_DOCUMENT_TYPES);
export type AssetDocumentType = z.infer<typeof assetDocumentType>;

export const MAINTENANCE_CONSUMABLE_PREVIEW_STATUSES = ['ready', 'unit_mismatch', 'insufficient'] as const;
export const maintenanceConsumablePreviewStatus = z.enum(MAINTENANCE_CONSUMABLE_PREVIEW_STATUSES);

// ---- 响应：资产及其嵌套 ------------------------------------------------------

/** 资产标量列；嵌在维护计划里时 createdBy 不在。 */
export const homeAssetRecordSchema = z.object({
  id: uuid,
  householdId: uuid,
  name: z.string(),
  category: assetCategory,
  location: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  purchaseDate: dateOnly.nullable(),
  purchasePrice: numericString.nullable(),
  warrantyExpiresOn: dateOnly.nullable(),
  renewsOn: dateOnly.nullable(),
  renewalIntervalMonths: assetRenewalIntervalMonths.nullable(),
  status: assetStatus,
  note: z.string().nullable(),
  createdById: uuid,
  createdBy: memberSchema.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** presentDocument()：私有文件的 url 置 null，要看内容走 /access 换签名地址。 */
export const assetDocumentRecordSchema = z.object({
  id: uuid,
  householdId: uuid,
  assetId: uuid,
  type: assetDocumentType,
  title: z.string(),
  url: z.string().nullable(),
  createdById: uuid,
  createdBy: memberSchema.optional(),
  createdAt: isoDateTime,
});
export const assetDocumentSchema = assetDocumentRecordSchema.extend({ createdBy: memberSchema });
export type AssetDocument = z.infer<typeof assetDocumentSchema>;

export const maintenanceConsumableSchema = z.object({
  id: uuid,
  householdId: uuid,
  planId: uuid,
  inventoryItemId: uuid,
  inventoryItem: inventoryItemSchema,
  quantity: numericString,
  unit: z.string(),
  createdById: uuid,
  createdBy: memberSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type MaintenanceConsumable = z.infer<typeof maintenanceConsumableSchema>;

/** 维护计划记录版（新建/修改/完成回传）：findOneByOrFail，没有 consumables。 */
export const maintenancePlanRecordSchema = z.object({
  id: uuid,
  householdId: uuid,
  assetId: uuid,
  asset: homeAssetRecordSchema.optional(),
  title: z.string(),
  frequencyDays: z.number().int(),
  nextDueDate: dateOnly,
  isEnabled: z.boolean(),
  note: z.string().nullable(),
  createdById: uuid,
  createdBy: memberSchema,
  consumables: z.array(maintenanceConsumableSchema).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
/** 资产详情里的维护计划：consumables 一定在（已按库存项名排序）。 */
export const maintenancePlanSchema = maintenancePlanRecordSchema.extend({
  consumables: z.array(maintenanceConsumableSchema),
});
export type MaintenancePlan = z.infer<typeof maintenancePlanSchema>;

export const maintenanceConsumableSnapshotSchema = z.object({
  consumableId: uuid,
  inventoryItemId: uuid,
  inventoryItemName: z.string(),
  quantity: z.number(),
  unit: z.string(),
  consumed: z.boolean(),
  quantityBefore: z.number().nullable(),
  quantityAfter: z.number().nullable(),
  transactionId: uuid.nullable(),
});
export type MaintenanceConsumableSnapshot = z.infer<typeof maintenanceConsumableSnapshotSchema>;

export const maintenanceInventoryConfirmationSchema = z.object({
  operationId: uuid.nullable(),
  reversed: z.boolean(),
  transactions: z.array(
    z.object({
      id: uuid,
      inventoryItemId: uuid,
      inventoryItemName: z.string(),
      quantityBefore: numericString,
      delta: numericString,
      quantityAfter: numericString,
      unit: z.string(),
      reversedAt: nullableDateTime,
    }),
  ),
});

/** 维护记录记录版（完成维护回传）：没有 inventoryConfirmation。 */
export const maintenanceRecordRecordSchema = z.object({
  id: uuid,
  householdId: uuid,
  assetId: uuid,
  planId: uuid,
  performedById: uuid,
  performedBy: memberSchema,
  performedAt: isoDateTime,
  cost: numericString.nullable(),
  note: z.string().nullable(),
  idempotencyKey: z.string(),
  nextDueDateBefore: dateOnly,
  nextDueDateAfter: dateOnly,
  consumablesSnapshot: z.array(maintenanceConsumableSnapshotSchema),
  inventoryOperationId: uuid.nullable(),
  createdAt: isoDateTime,
});
/** 资产详情里的维护记录：present() 补上 inventoryConfirmation（没扣库存则为 null）。 */
export const maintenanceRecordSchema = maintenanceRecordRecordSchema.extend({
  inventoryConfirmation: maintenanceInventoryConfirmationSchema.nullable(),
});
export type MaintenanceRecord = z.infer<typeof maintenanceRecordSchema>;

export const homeAssetSchema = homeAssetRecordSchema.extend({
  createdBy: memberSchema,
  documents: z.array(assetDocumentSchema),
  maintenancePlans: z.array(maintenancePlanSchema),
  maintenanceRecords: z.array(maintenanceRecordSchema),
});
export type HomeAsset = z.infer<typeof homeAssetSchema>;

// ---- 响应：其他 -------------------------------------------------------------

export const assetDocumentAccessSchema = z.object({
  url: z.string(),
  external: z.boolean(),
  expiresAt: nullableDateTime,
});
export type AssetDocumentAccess = z.infer<typeof assetDocumentAccessSchema>;

export const maintenanceConsumablesPreviewSchema = z.object({
  planId: uuid,
  assetId: uuid,
  assetName: z.string(),
  planTitle: z.string(),
  rows: z.array(
    z.object({
      consumableId: uuid,
      inventoryItemId: uuid,
      inventoryItemName: z.string(),
      quantity: z.number(),
      unit: z.string(),
      currentUnit: z.string(),
      quantityBefore: z.number(),
      quantityAfter: z.number().nullable(),
      shortage: z.number(),
      status: maintenanceConsumablePreviewStatus,
    }),
  ),
  canConsume: z.boolean(),
  hasShortage: z.boolean(),
});
export type MaintenanceConsumablesPreview = z.infer<typeof maintenanceConsumablesPreviewSchema>;

export const maintenanceShoppingResultSchema = z.object({
  date: dateOnly,
  createdCount: z.number().int(),
  existingCount: z.number().int(),
  satisfiedCount: z.number().int(),
  items: z.array(shoppingItemRecordSchema),
});
export type MaintenanceShoppingResult = z.infer<typeof maintenanceShoppingResultSchema>;

export const maintenanceCompletionResultSchema = z.object({
  alreadyCompleted: z.boolean(),
  record: maintenanceRecordRecordSchema,
  plan: maintenancePlanRecordSchema,
  transactions: z.array(inventoryTransactionRecordSchema),
});
export type MaintenanceCompletionResult = z.infer<typeof maintenanceCompletionResultSchema>;

// ---- 请求 -------------------------------------------------------------------

const money = z.number().min(0).max(9_999_999_999.99);

export const assetListQuery = z.object({
  status: z.enum(['active', 'retired', 'all']).optional(),
  category: assetCategory.optional(),
});

export const createAssetBody = z.object({
  name: z.string().min(1).max(120),
  category: assetCategory,
  location: z.string().max(80).nullish(),
  brand: z.string().max(80).nullish(),
  model: z.string().max(120).nullish(),
  serialNumber: z.string().max(120).nullish(),
  purchaseDate: dateOnly.nullish(),
  purchasePrice: money.nullish(),
  /** 只对 appliance / electronics / tool 生效 */
  warrantyExpiresOn: dateOnly.nullish(),
  /** 只对 subscription 生效 */
  renewsOn: dateOnly.nullish(),
  renewalIntervalMonths: assetRenewalIntervalMonths.nullish(),
  note: z.string().max(1000).nullish(),
});
export const updateAssetBody = createAssetBody
  .partial()
  .extend({ status: assetStatus.optional() });
export const renewSubscriptionBody = z.object({ renewedOn: dateOnly.optional() });

export const createAssetDocumentBody = z.object({
  type: assetDocumentType,
  title: z.string().min(1).max(120),
  url: z.string().min(1).max(2000),
});
/** multipart/form-data：文件字段 `file`（≤ 10MB，图片或 PDF）。 */
export const uploadAssetDocumentBody = createAssetDocumentBody.omit({ url: true });

export const createMaintenancePlanBody = z.object({
  title: z.string().min(1).max(120),
  frequencyDays: z.number().int().min(1).max(3650),
  nextDueDate: dateOnly,
  note: z.string().max(1000).nullish(),
});
export const updateMaintenancePlanBody = createMaintenancePlanBody
  .partial()
  .extend({ isEnabled: z.boolean().optional() });

export const completeMaintenanceBody = z.object({
  performedAt: isoDateOrDateTime.optional(),
  cost: money.nullish(),
  note: z.string().max(1000).nullish(),
  consumeInventory: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(120),
});

const consumableQuantity = z.number().min(0.01).max(99_999_999.99);
export const createMaintenanceConsumableBody = z.object({
  inventoryItemId: uuid,
  quantity: consumableQuantity,
});
export const updateMaintenanceConsumableBody = createMaintenanceConsumableBody.partial();
export const addMaintenanceShoppingBody = z.object({ date: isoDateOrDateTime });

// signDocumentAccess() 是 HMAC-SHA256 的 base64url（43 字符），不是十六进制——
// 和 memories 的照片签名（同样 HMAC-SHA256，但 digest('hex') 是 64 字符）不一样。
// assetDocumentAccessSchema.url 因为要兼容外链只能是 z.string()，约束不到这里，
// 所以这条正则是签名格式唯一的契约表达。
export const assetDocumentContentQuery = z.object({
  expires: z.coerce.number().int(),
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

// ---- 端点 -------------------------------------------------------------------

export const assets = {
  list: defineEndpoint({
    method: 'GET',
    path: '/assets',
    summary: '家庭资产（含资料、维护计划与耗材、维护记录；最多 200 条）',
    query: assetListQuery,
    response: z.array(homeAssetSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/assets',
    summary: '登记资产（保修/续费字段按类别生效）',
    body: createAssetBody,
    response: homeAssetSchema,
  }),
  get: defineEndpoint({
    method: 'GET',
    path: '/assets/:id',
    summary: '资产详情',
    params: idParams,
    response: homeAssetSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/assets/:id',
    summary: '修改资产或退役（退役会取消维护提醒）',
    params: idParams,
    body: updateAssetBody,
    response: homeAssetSchema,
  }),
  renew: defineEndpoint({
    method: 'POST',
    path: '/assets/:id/renew',
    summary: '订阅类资产按周期推进下次续费日',
    params: idParams,
    body: renewSubscriptionBody,
    response: homeAssetSchema,
  }),
  createDocument: defineEndpoint({
    method: 'POST',
    path: '/assets/:id/documents',
    summary: '添加外链资料',
    params: idParams,
    body: createAssetDocumentBody,
    response: assetDocumentRecordSchema,
  }),
  uploadDocument: defineEndpoint({
    method: 'POST',
    path: '/assets/:id/documents/upload',
    summary: '上传资料文件（multipart；存私有目录，url 回传为 null）',
    params: idParams,
    body: uploadAssetDocumentBody,
    response: assetDocumentRecordSchema,
  }),
  documentAccess: defineEndpoint({
    method: 'GET',
    path: '/asset-documents/:id/access',
    summary: '换取资料访问地址：外链原样返回，私有文件给 60 秒签名地址',
    params: idParams,
    response: assetDocumentAccessSchema,
  }),
  documentContent: defineEndpoint({
    method: 'GET',
    path: '/asset-documents/:id/content',
    summary: '私有资料正文（公开，签名 URL；二进制流，无 JSON 响应）',
    params: idParams,
    query: assetDocumentContentQuery,
    response: z.undefined(),
  }),
  removeDocument: defineEndpoint({
    method: 'DELETE',
    path: '/asset-documents/:id',
    summary: '移除资料（私有文件一并删除）',
    params: idParams,
    response: removedResponse,
  }),
  createPlan: defineEndpoint({
    method: 'POST',
    path: '/assets/:id/maintenance-plans',
    summary: '新建维护计划（同资产同名 409）',
    params: idParams,
    body: createMaintenancePlanBody,
    response: maintenancePlanRecordSchema,
  }),
  updatePlan: defineEndpoint({
    method: 'PATCH',
    path: '/maintenance-plans/:id',
    summary: '修改或停用维护计划',
    params: idParams,
    body: updateMaintenancePlanBody,
    response: maintenancePlanRecordSchema,
  }),
  createConsumable: defineEndpoint({
    method: 'POST',
    path: '/maintenance-plans/:id/consumables',
    summary: '给维护计划关联一个库存项作为耗材（同库存项 409）',
    params: idParams,
    body: createMaintenanceConsumableBody,
    response: maintenanceConsumableSchema,
  }),
  updateConsumable: defineEndpoint({
    method: 'PATCH',
    path: '/maintenance-consumables/:id',
    summary: '修改耗材关联（换库存项或用量）',
    params: idParams,
    body: updateMaintenanceConsumableBody,
    response: maintenanceConsumableSchema,
  }),
  removeConsumable: defineEndpoint({
    method: 'DELETE',
    path: '/maintenance-consumables/:id',
    summary: '解除耗材关联',
    params: idParams,
    response: removedResponse,
  }),
  consumablesPreview: defineEndpoint({
    method: 'GET',
    path: '/maintenance-plans/:id/consumables-preview',
    summary: '完成维护前预览耗材扣减：库存够不够、单位是否一致',
    params: idParams,
    response: maintenanceConsumablesPreviewSchema,
  }),
  addShoppingItems: defineEndpoint({
    method: 'POST',
    path: '/maintenance-plans/:id/shopping-items',
    summary: '把缺口耗材加入某日购物清单（幂等到日期 + 耗材）',
    params: idParams,
    body: addMaintenanceShoppingBody,
    response: maintenanceShoppingResultSchema,
  }),
  complete: defineEndpoint({
    method: 'POST',
    path: '/maintenance-plans/:id/complete',
    summary: '登记一次维护并推进下次到期日；可选扣减库存（幂等）',
    params: idParams,
    body: completeMaintenanceBody,
    response: maintenanceCompletionResultSchema,
  }),
};
