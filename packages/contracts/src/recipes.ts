import { z } from 'zod';
import { idParams, isoDateTime, memberSchema, uuid } from './common';
import { dishSchema, ingredientSchema, numericString } from './dishes';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/recipes/recipes.module.ts 与 docs/recipe-variants-acceptance.md

export const DISH_SKILL_LEVELS = ['learning', 'can_cook', 'signature'] as const;
export const dishSkillLevel = z.enum(DISH_SKILL_LEVELS);
export type DishSkillLevel = z.infer<typeof dishSkillLevel>;

export const dishRecipeVariantStepSchema = z
  .object({
    id: uuid,
    variantId: uuid,
    position: z.number().int(),
    text: z.string(),
    imageUrl: z.string().nullable(),
  });
export type DishRecipeVariantStep = z.infer<typeof dishRecipeVariantStepSchema>;

export const dishRecipeVariantLinkSchema = z
  .object({
    id: uuid,
    variantId: uuid,
    position: z.number().int(),
    title: z.string().nullable(),
    url: z.string(),
  });
export type DishRecipeVariantLink = z.infer<typeof dishRecipeVariantLinkSchema>;

export const dishRecipeVariantIngredientSchema = z
  .object({
    id: uuid,
    variantId: uuid,
    ingredientId: uuid,
    ingredient: ingredientSchema,
    quantity: numericString,
    unit: z.string(),
  });
export type DishRecipeVariantIngredient = z.infer<
  typeof dishRecipeVariantIngredientSchema
>;

export const dishRecipeVariantSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    dishId: uuid,
    name: z.string(),
    authorMemberId: uuid.nullable(),
    author: memberSchema.nullable(),
    isDefault: z.boolean(),
    isArchived: z.boolean(),
    note: z.string().nullable(),
    estMinutes: z.number().int().nullable(),
    ingredients: z.array(dishRecipeVariantIngredientSchema),
    steps: z.array(dishRecipeVariantStepSchema),
    referenceLinks: z.array(dishRecipeVariantLinkSchema),
    canManage: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type DishRecipeVariant = z.infer<typeof dishRecipeVariantSchema>;

/**
 * 成员厨艺记录（写操作回传形态）。`POST /member-dish-skills` 首次创建时直接回传
 * save 结果，此时没有 member 字段；列表/详情里的 skills 用下面的 memberDishSkillSchema。
 */
export const memberDishSkillRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    memberId: uuid,
    member: memberSchema.optional(),
    dishId: uuid,
    preferredRecipeId: uuid.nullable(),
    level: dishSkillLevel,
    note: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type MemberDishSkillRecord = z.infer<typeof memberDishSkillRecordSchema>;

/** 成员厨艺记录（列表/详情形态，member 总是带出）。 */
export const memberDishSkillSchema = memberDishSkillRecordSchema.extend({
  member: memberSchema,
});
export type MemberDishSkill = z.infer<typeof memberDishSkillSchema>;

/** 菜谱视图：菜品 + 所有未归档做法 + 成员厨艺。 */
export const recipeDishSchema = dishSchema.extend({
  recipeVariants: z.array(dishRecipeVariantSchema),
  skills: z.array(memberDishSkillSchema),
});
export type RecipeDish = z.infer<typeof recipeDishSchema>;

export const variantIngredientInput = z.object({
  ingredientId: uuid.optional(),
  name: z.string().max(120).optional(),
  category: z.string().optional(),
  quantity: z.number().min(0.01),
  unit: z.string().max(32),
});

export const upsertRecipeVariantBody = z.object({
  name: z.string().max(120).optional(),
  authorMemberId: uuid.nullish(),
  isDefault: z.boolean().optional(),
  note: z.string().max(1000).nullish(),
  estMinutes: z.number().int().min(1).nullish(),
  ingredients: z.array(variantIngredientInput).optional(),
  steps: z
    .array(
      z.object({
        text: z.string().max(2000),
        imageUrl: z.string().max(500).nullish(),
      }),
    )
    .optional(),
  referenceLinks: z
    .array(
      z.object({
        title: z.string().max(120).nullish(),
        url: z.string().max(1000),
      }),
    )
    .optional(),
});
export type UpsertRecipeVariantBody = z.infer<typeof upsertRecipeVariantBody>;

export const upsertDishSkillBody = z.object({
  dishId: uuid,
  memberId: uuid.optional(),
  preferredRecipeId: uuid.nullish(),
  level: dishSkillLevel.optional(),
  note: z.string().max(500).nullish(),
});
export type UpsertDishSkillBody = z.infer<typeof upsertDishSkillBody>;

export const recipes = {
  list: defineEndpoint({
    method: 'GET',
    path: '/recipes',
    summary: '全部在用菜品的菜谱视图',
    response: z.array(recipeDishSchema),
  }),
  get: defineEndpoint({
    method: 'GET',
    path: '/recipes/:dishId',
    summary: '单个菜品的菜谱视图',
    params: z.object({ dishId: uuid }),
    response: recipeDishSchema,
  }),
  createVariant: defineEndpoint({
    method: 'POST',
    path: '/dishes/:dishId/recipe-variants',
    summary: '为菜品新增一种做法（name 必填）',
    params: z.object({ dishId: uuid }),
    body: upsertRecipeVariantBody,
    response: dishRecipeVariantSchema,
  }),
  updateVariant: defineEndpoint({
    method: 'PATCH',
    path: '/recipe-variants/:id',
    summary: '修改做法（默认做法仅管理员，个人做法作者或管理员）',
    params: idParams,
    body: upsertRecipeVariantBody,
    response: dishRecipeVariantSchema,
  }),
  archiveVariant: defineEndpoint({
    method: 'DELETE',
    path: '/recipe-variants/:id',
    summary: '归档做法',
    params: idParams,
    response: z.object({ id: uuid, archived: z.literal(true) }),
  }),
  upsertSkill: defineEndpoint({
    method: 'POST',
    path: '/member-dish-skills',
    summary: '标记"我会做"、熟练度与常用做法',
    body: upsertDishSkillBody,
    response: memberDishSkillRecordSchema,
  }),
  removeSkill: defineEndpoint({
    method: 'DELETE',
    path: '/members/:memberId/dish-skills/:dishId',
    summary: '取消"我会做"',
    params: z.object({ memberId: uuid, dishId: uuid }),
    response: z.object({
      dishId: uuid,
      memberId: uuid,
      removed: z.literal(true),
    }),
  }),
};
