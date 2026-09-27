import { z } from 'zod';
import { idParams, removedResponse, uuid } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/dishes/dishes.module.ts（菜品基础资料与旧接口兼容）

export const DISH_CATEGORIES = ['荤菜', '素菜', '汤', '主食', '甜品'] as const;
export const dishCategory = z.enum(DISH_CATEGORIES);
export type DishCategory = z.infer<typeof dishCategory>;

export const INGREDIENT_CATEGORIES = [
  '蔬菜',
  '肉类',
  '海鲜',
  '蛋奶',
  '调料',
  '主食',
  '其他',
] as const;
export const ingredientCategory = z.enum(INGREDIENT_CATEGORIES);
export type IngredientCategory = z.infer<typeof ingredientCategory>;

/** 数据库 numeric 列经 pg 序列化后是字符串（如 "1.50"）。 */
export const numericString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const ingredientSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    category: z.string(),
    defaultUnit: z.string(),
    isPantryStaple: z.boolean(),
  });
export type Ingredient = z.infer<typeof ingredientSchema>;

export const dishIngredientSchema = z
  .object({
    id: uuid,
    dishId: uuid,
    ingredientId: uuid,
    ingredient: ingredientSchema,
    quantity: numericString,
    unit: z.string(),
  });
export type DishIngredient = z.infer<typeof dishIngredientSchema>;

export const dishRecipeStepSchema = z.object({
  text: z.string(),
  imageUrl: z.string().nullish(),
});
export type DishRecipeStep = z.infer<typeof dishRecipeStepSchema>;

export const dishReferenceLinkSchema = z.object({
  title: z.string().nullish(),
  url: z.string(),
});
export type DishReferenceLink = z.infer<typeof dishReferenceLinkSchema>;

export const dishSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    photoUrl: z.string().nullable(),
    category: dishCategory,
    difficulty: z.number().int(),
    estMinutes: z.number().int().nullable(),
    note: z.string().nullable(),
    recipeSteps: z.array(dishRecipeStepSchema),
    referenceLinks: z.array(dishReferenceLinkSchema),
    isActive: z.boolean(),
    createdBy: uuid.nullable(),
    ingredients: z.array(dishIngredientSchema),
  });
export type Dish = z.infer<typeof dishSchema>;

export const dishIngredientInput = z.object({
  ingredientId: uuid.optional(),
  /** 传 name 时按名称 find-or-create 食材 */
  name: z.string().optional(),
  category: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
});
export type DishIngredientInput = z.infer<typeof dishIngredientInput>;

export const upsertDishBody = z.object({
  name: z.string().optional(),
  category: dishCategory.optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  estMinutes: z.number().int().optional(),
  note: z.string().optional(),
  photoUrl: z.string().optional(),
  recipeSteps: z
    .array(
      z.object({
        text: z.string().max(2000),
        imageUrl: z.string().max(500).optional(),
      }),
    )
    .optional(),
  referenceLinks: z
    .array(
      z.object({
        title: z.string().max(120).optional(),
        url: z.string().max(1000),
      }),
    )
    .optional(),
  isActive: z.boolean().optional(),
  ingredients: z.array(dishIngredientInput).optional(),
});
export type UpsertDishBody = z.infer<typeof upsertDishBody>;

export const dishes = {
  list: defineEndpoint({
    method: 'GET',
    path: '/dishes',
    summary: '在用菜品列表（含默认做法与食材）',
    response: z.array(dishSchema),
  }),
  ingredients: defineEndpoint({
    method: 'GET',
    path: '/ingredients',
    summary: '家庭食材字典',
    response: z.array(ingredientSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/dishes',
    summary: '新建菜品（name 必填），同步生成家庭默认做法',
    body: upsertDishBody,
    response: dishSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/dishes/:id',
    summary: '修改菜品；改默认做法相关字段需要管理员',
    params: idParams,
    body: upsertDishBody,
    response: dishSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/dishes/:id',
    summary: '下架菜品（isActive=false）',
    params: idParams,
    response: removedResponse,
  }),
};
