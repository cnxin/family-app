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

// 对应 apps/api/src/memories/memories.module.ts 与 docs/m12-memories-acceptance.md
//
// 响应经 presentMemory() / presentPhoto() 逐字段挑选；写端点都回传整条回忆（detail()），
// 上传照片回传那张照片。照片正文走签名 URL（10 分钟有效），@Public + @Res 直接写二进制，
// 处理函数不返回值，所以契约 response 是 undefined。

export const FAMILY_MEMORY_CATEGORIES = [
  'daily',
  'celebration',
  'travel',
  'meal',
  'visit',
  'milestone',
  'other',
] as const;
export const familyMemoryCategory = z.enum(FAMILY_MEMORY_CATEGORIES);
export type FamilyMemoryCategory = z.infer<typeof familyMemoryCategory>;

export const FAMILY_MEMORY_SOURCE_MODULES = [
  'calendar',
  'travel',
  'menu',
  'media',
  'visit',
] as const;
export const familyMemorySourceModule = z.enum(FAMILY_MEMORY_SOURCE_MODULES);
export type FamilyMemorySourceModule = z.infer<typeof familyMemorySourceModule>;

export const FAMILY_MEMORY_PHOTO_MIME_TYPES = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const idempotencyKey = z.string().min(1).max(180);
const expectedVersion = z.number().int().min(1);

// ---- 响应 -------------------------------------------------------------------

/** presentPhoto()：contentUrl 带 expires/signature，每次响应都重新签。 */
export const familyMemoryPhotoSchema = z.object({
  id: uuid,
  caption: z.string().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  contentUrl: z.string().regex(/^\/memories\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}\/content\?expires=\d+&signature=[0-9a-f]{64}$/),
  createdBy: memberBriefSchema.nullable(),
  createdAt: isoDateTime,
});
export type FamilyMemoryPhoto = z.infer<typeof familyMemoryPhotoSchema>;

export const familyMemorySchema = z.object({
  id: uuid,
  title: z.string(),
  happenedOn: dateOnly,
  category: familyMemoryCategory,
  story: z.string().nullable(),
  tags: z.array(z.string()),
  source: z
    .object({
      module: familyMemorySourceModule,
      id: uuid,
      targetPath: z.string(),
    })
    .nullable(),
  version: z.number().int(),
  photos: z.array(familyMemoryPhotoSchema),
  createdBy: memberBriefSchema,
  updatedBy: memberBriefSchema,
  archivedAt: nullableDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  canEdit: z.boolean(),
});
export type FamilyMemory = z.infer<typeof familyMemorySchema>;

// ---- 请求 -------------------------------------------------------------------

export const memoryListQuery = z.object({
  status: z.enum(['active', 'archived', 'all']).optional(),
  category: familyMemoryCategory.optional(),
  q: z.string().max(80).optional(),
  tag: z.string().max(24).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const createMemoryBody = z.object({
  title: z.string().min(1).max(120),
  happenedOn: dateOnly,
  category: familyMemoryCategory,
  story: z.string().max(5000).nullish(),
  tags: z.array(z.string().max(24)).max(8).optional(),
  sourceModule: familyMemorySourceModule.nullish(),
  sourceId: uuid.nullish(),
  idempotencyKey,
});
export const updateMemoryBody = createMemoryBody
  .omit({ idempotencyKey: true })
  .partial()
  .extend({ expectedVersion, idempotencyKey });
export const memoryVersionOperationBody = z.object({ expectedVersion, idempotencyKey });

/** multipart/form-data：文件字段 `file`（控制器是 FileInterceptor('file')；≤ 10MB，gif/jpeg/png/webp），其余字段如下。 */
export const uploadMemoryPhotoBody = z.object({
  caption: z.string().max(240).nullish(),
  idempotencyKey,
});

export const memoryPhotoParams = z.object({ memoryId: uuid, photoId: uuid });
export const memoryPhotoContentQuery = z.object({
  expires: z.coerce.number().int(),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

// ---- 端点 -------------------------------------------------------------------

export const memories = {
  list: defineEndpoint({
    method: 'GET',
    path: '/memories',
    summary: '家庭回忆列表（按发生日期倒序；支持分类、标签、年份、全文筛选）',
    query: memoryListQuery,
    response: z.array(familyMemorySchema),
  }),
  detail: defineEndpoint({
    method: 'GET',
    path: '/memories/:id',
    summary: '回忆详情',
    params: idParams,
    response: familyMemorySchema,
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/memories',
    summary: '记一条回忆（幂等；可关联日历/出行/菜单/媒体/来访）',
    body: createMemoryBody,
    response: familyMemorySchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/memories/:id',
    summary: '修改回忆（乐观锁 + 幂等）',
    params: idParams,
    body: updateMemoryBody,
    response: familyMemorySchema,
  }),
  archive: defineEndpoint({
    method: 'POST',
    path: '/memories/:id/archive',
    summary: '归档回忆',
    params: idParams,
    body: memoryVersionOperationBody,
    response: familyMemorySchema,
  }),
  restore: defineEndpoint({
    method: 'POST',
    path: '/memories/:id/restore',
    summary: '恢复已归档回忆',
    params: idParams,
    body: memoryVersionOperationBody,
    response: familyMemorySchema,
  }),
  uploadPhoto: defineEndpoint({
    method: 'POST',
    path: '/memories/:id/photos',
    summary: '上传回忆照片（multipart，幂等；存私有目录）',
    params: idParams,
    body: uploadMemoryPhotoBody,
    response: familyMemoryPhotoSchema,
  }),
  photoContent: defineEndpoint({
    method: 'GET',
    path: '/memories/:memoryId/photos/:photoId/content',
    summary: '照片正文（公开，签名 URL 10 分钟有效；二进制流，无 JSON 响应）',
    params: memoryPhotoParams,
    query: memoryPhotoContentQuery,
    response: z.undefined(),
  }),
};
