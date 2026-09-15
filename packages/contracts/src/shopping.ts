import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  nullableDateTime,
  removedResponse,
  uuid,
} from './common';
import { ingredientSchema, numericString } from './dishes';
import { inventoryItemSchema } from './inventory';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/shopping/shopping.module.ts 与 docs/m6-inventory-shopping-acceptance.md

export const SHOPPING_ITEM_SOURCES = ['auto', 'manual', 'maintenance'] as const;
export const shoppingItemSource = z.enum(SHOPPING_ITEM_SOURCES);
export type ShoppingItemSource = z.infer<typeof shoppingItemSource>;

/** 购物项已确认入库时附带的流水摘要。 */
export const shoppingInventoryConfirmationSchema = z
  .object({
    transactionId: uuid,
    inventoryItemId: uuid,
    inventoryItemName: z.string(),
    quantityBefore: numericString,
    delta: numericString,
    quantityAfter: numericString,
    unit: z.string(),
    actorName: z.string(),
    createdAt: isoDateTime,
    reversedAt: nullableDateTime,
  })
  .loose();
export type ShoppingInventoryConfirmation = z.infer<
  typeof shoppingInventoryConfirmationSchema
>;

/** 购物项实体（POST/PATCH 直接回传 save 结果，关联与确认摘要可能缺席）。 */
export const shoppingItemRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    date: dateOnly,
    ingredientId: uuid.nullable(),
    ingredient: ingredientSchema.nullish(),
    customName: z.string().nullable(),
    totalQty: numericString.nullable(),
    requiredQty: numericString.nullish(),
    availableQty: numericString.nullish(),
    unit: z.string().nullable(),
    checked: z.boolean(),
    source: shoppingItemSource,
    inventoryItemId: uuid.nullish(),
    inventoryItem: inventoryItemSchema.nullish(),
    maintenanceConsumableId: uuid.nullish(),
  })
  .loose();
export type ShoppingItemRecord = z.infer<typeof shoppingItemRecordSchema>;

/** 清单行：完整实体（find 出来的所有列都在）+ 入库确认摘要。 */
export const shoppingItemSchema = shoppingItemRecordSchema.extend({
  ingredient: ingredientSchema.nullable(),
  requiredQty: numericString.nullable(),
  availableQty: numericString.nullable(),
  inventoryItemId: uuid.nullable(),
  inventoryItem: inventoryItemSchema.nullable(),
  maintenanceConsumableId: uuid.nullable(),
  inventoryConfirmation: shoppingInventoryConfirmationSchema.nullable(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

export const shoppingDateQuery = z.object({ date: dateOnly });

export const manualShoppingItemBody = z.object({
  date: isoDateOrDateTime,
  customName: z.string(),
  totalQty: z.number().min(0.01).optional(),
  unit: z.string().optional(),
});
export type ManualShoppingItemBody = z.infer<typeof manualShoppingItemBody>;

export const shopping = {
  list: defineEndpoint({
    method: 'GET',
    path: '/shopping-list',
    summary: '某日购物清单（按食材分类排序，手动项最后）',
    query: shoppingDateQuery,
    response: z.array(shoppingItemSchema),
  }),
  generate: defineEndpoint({
    method: 'POST',
    path: '/shopping-list/generate',
    summary: '按"菜单需求 - 可用库存"重新生成某日自动项，返回整份清单',
    body: z.object({ date: isoDateOrDateTime }),
    response: z.array(shoppingItemSchema),
  }),
  addManual: defineEndpoint({
    method: 'POST',
    path: '/shopping-items',
    summary: '手动添加购物项',
    body: manualShoppingItemBody,
    response: shoppingItemRecordSchema,
  }),
  check: defineEndpoint({
    method: 'PATCH',
    path: '/shopping-items/:id',
    summary: '勾选/取消勾选已购',
    params: idParams,
    body: z.object({ checked: z.boolean() }),
    response: shoppingItemRecordSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/shopping-items/:id',
    summary: '删除购物项',
    params: idParams,
    response: removedResponse,
  }),
};
