import { z } from 'zod';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/upload/upload.module.ts（multipart 图片上传）

export const uploadResultSchema = z.object({
  /** `/uploads/<filename>`，客户端用 photoUri() 拼成完整地址 */
  url: z.string().regex(/^\/uploads\//),
});
export type UploadResult = z.infer<typeof uploadResultSchema>;

export const upload = {
  photo: defineEndpoint({
    method: 'POST',
    path: '/upload',
    summary: 'multipart 上传一张图片（字段名 file），返回公开访问路径',
    response: uploadResultSchema,
  }),
};
