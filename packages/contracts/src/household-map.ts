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
/** 家具朝向（地图编辑器 v2 §3.4）：「转 90°」照旧绕中心换宽高，再把朝向 +90，只管图标怎么画 */
export const mapRotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type MapRotation = z.infer<typeof mapRotationSchema>;
/** 柜子 / 家具用矩形；不带 rotation 就是 0（老数据不用动） */
export const mapRectSchema = z
  .object({ type: z.literal('rect'), x: coord, y: coord, w: extent, h: extent, rotation: mapRotationSchema.optional() })
  .strict();
export const mapShapeSchema = z.discriminatedUnion('type', [mapPolygonSchema, mapRectSchema]);
export type MapPolygon = z.infer<typeof mapPolygonSchema>;
export type MapRect = z.infer<typeof mapRectSchema>;
export type MapShape = z.infer<typeof mapShapeSchema>;

export const mapViewBoxSchema = z
  .object({ w: z.literal(MAP_VIEWBOX_WIDTH), h: z.number().int().min(100).max(MAP_VIEWBOX_MAX_HEIGHT) })
  .strict();
export type MapViewBox = z.infer<typeof mapViewBoxSchema>;

/**
 * 家具库（地图编辑器 v2 §3）。收纳类是位置（container，storage_locations.icon 存类型键），进树、能放东西；
 * 装饰类只画在图上（household_maps.decorations），不进树、不起名（v2 拍板 4）。
 */
export const MAP_STORAGE_FURNITURE = ['wardrobe', 'shoe', 'tv', 'wall', 'base', 'fridge', 'bookcase', 'nightstand', 'shelf', 'drawers'] as const;
export const MAP_DECOR_FURNITURE = ['sofa', 'bed', 'dining', 'desk', 'toilet', 'bathtub', 'washer', 'stove'] as const;
export const mapStorageFurnitureSchema = z.enum(MAP_STORAGE_FURNITURE);
export const mapDecorFurnitureSchema = z.enum(MAP_DECOR_FURNITURE);
export type MapStorageFurniture = z.infer<typeof mapStorageFurnitureSchema>;
export type MapDecorFurniture = z.infer<typeof mapDecorFurnitureSchema>;
export const MAP_DECORATIONS_MAX = 200;

export const mapDecorationSchema = z
  .object({
    id: z.uuid(),
    kind: mapDecorFurnitureSchema,
    /** 画在哪间房里（挪房间时跟着走）；房间删了就是 null */
    roomId: z.uuid().nullable(),
    x: coord,
    y: coord,
    w: extent,
    h: extent,
    rotation: mapRotationSchema.optional(),
  })
  .strict();
export type MapDecoration = z.infer<typeof mapDecorationSchema>;

export const householdMapSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  viewBox: mapViewBoxSchema,
  /** 有没有底图（裁剪后的截图）；图本身走 GET /map/background（要登录，不走公开 /uploads） */
  hasBackground: z.boolean(),
  /** 底图换了这个就变（客户端拿它当缓存键；改装饰不动它，免得重下图片） */
  backgroundKey: z.string().nullable(),
  decorations: z.array(mapDecorationSchema),
  /** 装饰整列替换时的版本号：对不上 409（别的设备刚改过） */
  decorationsVersion: z.number().int().min(0),
  updatedAt: isoDateTime,
});
export type HouseholdMap = z.infer<typeof householdMapSchema>;

export const putMapDecorationsBody = z
  .object({ version: z.number().int().min(0), items: z.array(mapDecorationSchema).max(MAP_DECORATIONS_MAX) })
  .strict();
export type PutMapDecorationsBody = z.infer<typeof putMapDecorationsBody>;

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
  putDecorations: defineEndpoint({
    method: 'PUT',
    path: '/map/decorations',
    summary: '整列替换装饰类家具（管理员；版本号对不上 409）',
    body: putMapDecorationsBody,
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
