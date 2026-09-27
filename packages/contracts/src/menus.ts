import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import {
  dishIngredientSchema,
  dishReferenceLinkSchema,
  dishRecipeStepSchema,
  dishSchema,
} from './dishes';
import { dishRecipeVariantSchema } from './recipes';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/menus/menus.module.ts（点菜、厨房协作、菜单事件与点菜提醒）
// 与 docs/m2-acceptance.md、docs/recipe-variants-acceptance.md

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;
export const mealType = z.enum(MEAL_TYPES);
export type MealType = z.infer<typeof mealType>;

export const MENU_STATUSES = ['open', 'done'] as const;
export const menuStatus = z.enum(MENU_STATUSES);
export type MenuStatus = z.infer<typeof menuStatus>;

export const MENU_ITEM_STATUSES = [
  'pending',
  'accepted',
  'cooking',
  'done',
  'rejected',
] as const;
export const menuItemStatus = z.enum(MENU_ITEM_STATUSES);
export type MenuItemStatus = z.infer<typeof menuItemStatus>;

export const MENU_EVENT_TYPES = [
  'item_ordered',
  'item_status_changed',
  'item_assigned',
  'item_note_changed',
  'meal_chef_assigned',
  'menu_completed',
] as const;
export const menuEventType = z.enum(MENU_EVENT_TYPES);
export type MenuEventType = z.infer<typeof menuEventType>;

/** 点菜时固化的做法快照（jsonb），历史采购不受后续编辑影响。 */
export const dishRecipeSnapshotSchema = z
  .object({
    variantId: uuid,
    name: z.string(),
    authorMemberId: uuid.nullable(),
    authorName: z.string().nullable(),
    note: z.string().nullable(),
    estMinutes: z.number().int().nullable(),
    ingredients: z.array(
      z
        .object({
          ingredientId: uuid,
          name: z.string(),
          category: z.string(),
          isPantryStaple: z.boolean(),
          quantity: z.number(),
          unit: z.string(),
        }),
    ),
    steps: z.array(dishRecipeStepSchema),
    referenceLinks: z.array(dishReferenceLinkSchema),
  });
export type DishRecipeSnapshot = z.infer<typeof dishRecipeSnapshotSchema>;

/**
 * 菜单项里嵌套的菜品。`/menus` 系列用 `findOne({ relations: { items: true } })` 加载，
 * 显式 relations 会让 eager 递归在 `items.dish` 这一层停住，`dish.ingredients` 不带出；
 * 而 `/menus/:id/events`、`/menu-notifications` 不指定 relations，eager 全开，会带出。
 * 所以这里把 ingredients 设为可选——真正需要食材的场景应看 `recipeSnapshot`。
 */
export const menuDishSchema = dishSchema.extend({
  ingredients: z.array(dishIngredientSchema).optional(),
});

/** 菜单项。dish / requestedBy / assignedTo 为 eager 关联；recipeVariant 不是，可能缺席。 */
export const menuItemSchema = z
  .object({
    id: uuid,
    menuId: uuid,
    dishId: uuid,
    dish: menuDishSchema,
    requestedById: uuid,
    requestedBy: memberSchema,
    note: z.string().nullable(),
    status: menuItemStatus,
    statusReason: z.string().nullable(),
    assignedToId: uuid.nullable(),
    assignedTo: memberSchema.nullable(),
    recipeVariantId: uuid.nullable(),
    recipeVariant: dishRecipeVariantSchema.nullish(),
    recipeSnapshot: dishRecipeSnapshotSchema.nullable(),
    createdAt: isoDateTime,
  });
export type MenuItem = z.infer<typeof menuItemSchema>;

/** 菜单实体（作为 MenuEvent.menu 嵌套时 items 未加载）。 */
export const menuRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    date: dateOnly,
    mealType,
    status: menuStatus,
    chefId: uuid.nullable(),
    chef: memberSchema.nullable(),
    completedAt: nullableDateTime,
    completedById: uuid.nullable(),
    completedBy: memberSchema.nullable(),
    items: z.array(menuItemSchema).optional(),
  });
export type MenuRecord = z.infer<typeof menuRecordSchema>;

/** /menus 系列端点返回的菜单：一定带 items。 */
export const menuSchema = menuRecordSchema.extend({
  items: z.array(menuItemSchema),
});
export type Menu = z.infer<typeof menuSchema>;

/** 菜单事件 / 点菜人提醒。recipient 非 eager，可能缺席。 */
export const menuEventSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    menuId: uuid,
    menu: menuRecordSchema,
    menuItemId: uuid.nullable(),
    menuItem: menuItemSchema.nullable(),
    actorId: uuid,
    actor: memberSchema,
    recipientId: uuid.nullable(),
    recipient: memberSchema.nullish(),
    type: menuEventType,
    fromValue: z.string().nullable(),
    toValue: z.string().nullable(),
    reason: z.string().nullable(),
    readAt: nullableDateTime,
    createdAt: isoDateTime,
  });
export type MenuEvent = z.infer<typeof menuEventSchema>;

export const menuDateCountSchema = z.object({
  date: dateOnly,
  count: z.number().int(),
});
export type MenuDateCount = z.infer<typeof menuDateCountSchema>;

export const menuDateRangeQuery = z.object({
  start: isoDateOrDateTime,
  end: isoDateOrDateTime,
});

export const menuQuery = z.object({
  date: isoDateOrDateTime,
  mealType: mealType.optional(),
});

export const orderItemInput = z.object({
  dishId: uuid,
  recipeVariantId: uuid.optional(),
  note: z.string().max(200).optional(),
});
export type OrderItemInput = z.infer<typeof orderItemInput>;

export const addMenuItemsBody = z.object({
  items: z.array(orderItemInput).min(1),
});
export type AddMenuItemsBody = z.infer<typeof addMenuItemsBody>;

export const updateMenuItemBody = z.object({
  status: menuItemStatus.optional(),
  note: z.string().max(200).optional(),
  assignedToId: uuid.nullish(),
  reason: z.string().max(200).optional(),
  recipeVariantId: uuid.optional(),
});
export type UpdateMenuItemBody = z.infer<typeof updateMenuItemBody>;

export const assignChefBody = z.object({
  chefId: uuid.nullish(),
});

export const menus = {
  dateCounts: defineEndpoint({
    method: 'GET',
    path: '/menu-dates',
    summary: '日期区间内每天已点（未划掉）菜数',
    query: menuDateRangeQuery,
    response: z.array(menuDateCountSchema),
  }),
  get: defineEndpoint({
    method: 'GET',
    path: '/menus',
    summary: '带 mealType 返回单餐菜单（不存在则创建）；不带返回早中晚三餐',
    query: menuQuery,
    response: z.union([menuSchema, z.array(menuSchema)]),
  }),
  addItems: defineEndpoint({
    method: 'POST',
    path: '/menus/:id/items',
    summary: '点菜（默认家庭做法，可指定做法）',
    params: idParams,
    body: addMenuItemsBody,
    response: menuSchema,
  }),
  updateItem: defineEndpoint({
    method: 'PATCH',
    path: '/menu-items/:id',
    summary: '认领/改派/进度/划掉/恢复/改备注/换做法',
    params: idParams,
    body: updateMenuItemBody,
    response: menuItemSchema,
  }),
  assignChef: defineEndpoint({
    method: 'PATCH',
    path: '/menus/:id/chef',
    summary: '指定或取消本餐主厨',
    params: idParams,
    body: assignChefBody,
    response: menuSchema,
  }),
  complete: defineEndpoint({
    method: 'POST',
    path: '/menus/:id/complete',
    summary: '结束并锁定本餐（幂等）',
    params: idParams,
    response: menuSchema,
  }),
  events: defineEndpoint({
    method: 'GET',
    path: '/menus/:id/events',
    summary: '本餐最近 30 条操作历史',
    params: idParams,
    response: z.array(menuEventSchema),
  }),
  notifications: defineEndpoint({
    method: 'GET',
    path: '/menu-notifications',
    summary: '发给我的未读点菜提醒（旧接口，站内通知已统一到 /notifications）',
    response: z.array(menuEventSchema),
  }),
  markNotificationRead: defineEndpoint({
    method: 'PATCH',
    path: '/menu-notifications/:id/read',
    summary: '标记点菜提醒已读（同步站内通知）',
    params: idParams,
    response: menuEventSchema,
  }),
};
