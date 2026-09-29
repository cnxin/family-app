import { z } from 'zod';
import { isoDateTime } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/locations/map.*（I2 家庭地图，docs/item-location-plan.md §2.2、§3 I2）。
// 一个家庭一张地图；房间 / 区域 / 柜子的形状存在各自位置的 mapShape 里，坐标是这张图 viewBox 里的整数。
// viewBox 宽固定 1000，高按导入时裁剪后的图片比例定，之后不再变——换了底图坐标照样对得上。

/** viewBox 的宽固定 1000；高 = round(1000 × 图高 / 图宽) */
export const MAP_VIEWBOX_WIDTH = 1000;
export const MAP_VIEWBOX_MAX_HEIGHT = 4000;
/** 底图 PNG / JPEG / WebP，≤ 2 MB */
export const MAP_BACKGROUND_MAX_BYTES = 2 * 1024 * 1024;
export const MAP_POLYGON_MAX_POINTS = 64;

const coord = z.number().int().min(0).max(MAP_VIEWBOX_MAX_HEIGHT);
const extent = z.number().int().min(1).max(MAP_VIEWBOX_MAX_HEIGHT);

export const mapPolygonSchema = z
  .object({ type: z.literal('polygon'), points: z.array(z.tuple([coord, coord])).min(3).max(MAP_POLYGON_MAX_POINTS) })
  .strict();
/** 柜子用矩形；「转 90°」就是绕中心换宽高，所以不存角度 */
export const mapRectSchema = z.object({ type: z.literal('rect'), x: coord, y: coord, w: extent, h: extent }).strict();
export const mapShapeSchema = z.discriminatedUnion('type', [mapPolygonSchema, mapRectSchema]);
export type MapPolygon = z.infer<typeof mapPolygonSchema>;
export type MapRect = z.infer<typeof mapRectSchema>;
export type MapShape = z.infer<typeof mapShapeSchema>;

export const mapViewBoxSchema = z
  .object({ w: z.literal(MAP_VIEWBOX_WIDTH), h: z.number().int().min(100).max(MAP_VIEWBOX_MAX_HEIGHT) })
  .strict();
export type MapViewBox = z.infer<typeof mapViewBoxSchema>;

export const householdMapSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  viewBox: mapViewBoxSchema,
  /** 有没有底图（裁剪后的截图）；图本身走 GET /map/background（要登录，不走公开 /uploads） */
  hasBackground: z.boolean(),
  updatedAt: isoDateTime,
});
export type HouseholdMap = z.infer<typeof householdMapSchema>;

export const putHouseholdMapBody = z
  .object({
    title: z.string().trim().min(1).max(40).optional(),
    viewBox: mapViewBoxSchema,
    /** 重新导入（比例变了）时要显式清掉现有房间 / 柜子的形状；位置本身和东西都不动 */
    clearShapes: z.boolean().optional(),
  })
  .strict();
export type PutHouseholdMapBody = z.infer<typeof putHouseholdMapBody>;

/** GET /map/export：地图 + 所有位置（含归档的）的形状 + 底图本身，自己留一份、换机器导回来用 */
export const householdMapExportSchema = z.object({
  exportedAt: isoDateTime,
  map: householdMapSchema,
  locations: z.array(
    z.object({
      id: z.uuid(),
      parentId: z.uuid().nullable(),
      kind: z.enum(['room', 'zone', 'container', 'slot']),
      name: z.string(),
      pathLabel: z.string(),
      mapShape: mapShapeSchema.nullable(),
      archivedAt: isoDateTime.nullable(),
    }),
  ),
  /** 底图原样（base64）；没传过是 null */
  background: z.object({ contentType: z.string(), base64: z.string() }).nullable(),
});
export type HouseholdMapExport = z.infer<typeof householdMapExportSchema>;

export const householdMap = {
  get: defineEndpoint({
    method: 'GET',
    path: '/map',
    summary: '家庭地图（没导入过是 null）',
    response: householdMapSchema.nullable(),
  }),
  put: defineEndpoint({
    method: 'PUT',
    path: '/map',
    summary: '建 / 改家庭地图（管理员；换比例要 clearShapes）',
    body: putHouseholdMapBody,
    response: householdMapSchema,
  }),
  uploadBackground: defineEndpoint({
    method: 'POST',
    path: '/map/background',
    summary: '上传底图（管理员；multipart 字段 file，PNG / JPEG / WebP ≤ 2 MB，存私有目录）',
    response: householdMapSchema,
  }),
  export: defineEndpoint({
    method: 'GET',
    path: '/map/export',
    summary: '导出地图（管理员；地图、所有位置的形状、底图 base64）',
    response: householdMapExportSchema,
  }),
  background: defineEndpoint({
    method: 'GET',
    path: '/map/background',
    summary: '底图图片（要登录；二进制流，无 JSON 响应）',
    response: z.undefined(),
  }),
};
