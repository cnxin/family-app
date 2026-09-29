import { z } from 'zod';
import { idParams, isoDateTime, nullableDateTime, removedResponse, uuid } from './common';
import { numericString } from './dishes';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/locations/（I1 位置字典，docs/item-location-plan.md §2、§3 I1）。
// 位置是「上次放在」，不是真相；三级到顶（房间 → 柜子 / 区域 → 层格），同一层里没归档的不重名。
// 地图（mapShape、household_maps）是 I2 的事，这里的契约一概不带。

export const STORAGE_LOCATION_KINDS = ['room', 'zone', 'container', 'slot'] as const;
export const storageLocationKind = z.enum(STORAGE_LOCATION_KINDS);
export type StorageLocationKind = z.infer<typeof storageLocationKind>;

/** 三级到顶 */
export const STORAGE_LOCATION_MAX_DEPTH = 3;
/** 系统节点「未整理」的名字：家人在选择器里新建的位置挂在它下面，管理员事后归位 */
export const UNSORTED_LOCATION_NAME = '未整理';

const locationName = z.string().trim().min(1).max(40);

export const storageLocationSchema = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  kind: storageLocationKind,
  name: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  note: z.string().nullable(),
  /** 'unsorted' = 系统节点「未整理」（不能改名、移动、归档、删除） */
  systemKey: z.enum(['unsorted']).nullable(),
  archivedAt: nullableDateTime,
  /** 1 = 房间，2 = 柜子 / 区域，3 = 层格 */
  depth: z.number().int().min(1).max(STORAGE_LOCATION_MAX_DEPTH),
  /** 「客厅 / 电视柜 / 第二层」：服务端拼好，客户端不自己拼 */
  pathLabel: z.string(),
  /** 直接放在这儿的库存物品（默认位置）、有余量的批次、资产各几样；不含子位置 */
  itemCount: z.number().int().min(0),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type StorageLocation = z.infer<typeof storageLocationSchema>;

export const storageLocationsQuery = z.object({
  /** 管理页要看归档的；选择器不要 */
  includeArchived: z.enum(['true', 'false']).optional(),
}).strict();

/** 按树的先序排好的平铺列表（父在子前、同层按 sortOrder 再按名字）。 */
export const storageLocationListSchema = z.array(storageLocationSchema);

export const createStorageLocationBody = z.object({
  /** 管理员：空 = 房间；家人：忽略，一律挂在「未整理」下 */
  parentId: uuid.nullish(),
  /** 不填按层级推：房间下默认 zone，柜子（container）下默认 slot */
  kind: storageLocationKind.optional(),
  name: locationName,
  icon: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(500).nullish(),
}).strict();
export type CreateStorageLocationBody = z.infer<typeof createStorageLocationBody>;

/** 管理员：改名、换图标 / 备注、排序、挪到别的上级（整棵子树一起挪，深度仍不超过 3） */
export const updateStorageLocationBody = z.object({
  parentId: uuid.nullish(),
  kind: storageLocationKind.optional(),
  name: locationName.optional(),
  icon: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).strict();
export type UpdateStorageLocationBody = z.infer<typeof updateStorageLocationBody>;

export const storageLocationSearchQuery = z.object({ q: z.string().trim().min(1).max(40) }).strict();
export const storageLocationSearchResultSchema = z.array(
  z.object({ id: uuid, name: z.string(), kind: storageLocationKind, pathLabel: z.string() }),
);

/** 这个位置和它的子位置下放着什么（按类型分组） */
export const storageLocationContentsSchema = z.object({
  location: storageLocationSchema,
  items: z.array(z.object({
    id: uuid,
    name: z.string(),
    quantity: numericString,
    unit: z.string(),
    locationId: uuid,
  })),
  batches: z.array(z.object({
    id: uuid,
    inventoryItemId: uuid,
    itemName: z.string(),
    quantity: numericString,
    unit: z.string(),
    expiresOn: z.string().nullable(),
    locationId: uuid,
  })),
  assets: z.array(z.object({ id: uuid, name: z.string(), category: z.string(), locationId: uuid })),
});
export type StorageLocationContents = z.infer<typeof storageLocationContentsSchema>;

/** 一跳改位置（「找不到 → 改」）：批次、资产共用；null = 不记了 */
export const setLocationBody = z.object({ locationId: uuid.nullable() }).strict();
export type SetLocationBody = z.infer<typeof setLocationBody>;

export const locations = {
  list: defineEndpoint({
    method: 'GET',
    path: '/locations',
    summary: '位置树（先序平铺，含路径与每个位置直接放着几样）',
    query: storageLocationsQuery,
    response: storageLocationListSchema,
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/locations',
    summary: '新建位置（家人建的挂在「未整理」下）',
    body: createStorageLocationBody,
    response: storageLocationSchema,
  }),
  search: defineEndpoint({
    method: 'GET',
    path: '/locations/search',
    summary: '按名字搜位置（⌘K 用）',
    query: storageLocationSearchQuery,
    response: storageLocationSearchResultSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/locations/:id',
    summary: '改位置（管理员）',
    params: idParams,
    body: updateStorageLocationBody,
    response: storageLocationSchema,
  }),
  archive: defineEndpoint({
    method: 'POST',
    path: '/locations/:id/archive',
    summary: '归档位置及其子位置（管理员；有东西引用也可以，东西的记录保留）',
    params: idParams,
    response: storageLocationSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/locations/:id',
    summary: '删除位置（管理员；有子位置或被引用时 409，只能归档）',
    params: idParams,
    response: removedResponse,
  }),
  contents: defineEndpoint({
    method: 'GET',
    path: '/locations/:id/contents',
    summary: '这个位置及子位置下的物品、批次、资产',
    params: idParams,
    response: storageLocationContentsSchema,
  }),
};
