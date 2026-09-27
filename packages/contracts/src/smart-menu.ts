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
import { dishIngredientSchema, dishSchema, ingredientSchema } from './dishes';
import { dishRecipeVariantSchema } from './recipes';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/smart-menu/smart-menu.module.ts 与 docs/m7-food-batches-smart-menu-acceptance.md
//
// 四个端点都经 get()/list() 回传，加载方式相同：
// find({ relations: { candidates: { dish, recipeVariant }, poll: { options: { votes } } } })。
// 显式 relations 到 candidates.dish 为止，再往下只带一层 eager：
//   dish.ingredients 有，ingredients[].ingredient 没有（对比 /menus：relations 到 items 为止，
//   items.dish 有、dish.ingredients 没有——同一条链，起点差一层，断点就差一层）。
// candidate.recipeVariant 同理：steps/ingredients 可能缺席（用宽松版），present() 里的 canManage 也不存在。

export const SMART_MENU_PLAN_STATUSES = ['draft', 'voting', 'adopted'] as const;
export const smartMenuPlanStatus = z.enum(SMART_MENU_PLAN_STATUSES);
export type SmartMenuPlanStatus = z.infer<typeof smartMenuPlanStatus>;

/** candidates.dish：ingredients 带出，但每条 ingredient 关系缺席。 */
const smartMenuDishSchema = dishSchema.extend({
  ingredients: z.array(dishIngredientSchema.extend({ ingredient: ingredientSchema.optional() })),
});

const smartMenuVariantSchema = dishRecipeVariantSchema.extend({
  author: memberSchema.nullish(),
  ingredients: z.array(z.unknown()).optional(),
  steps: z.array(z.unknown()).optional(),
  referenceLinks: z.array(z.unknown()).optional(),
  canManage: z.boolean().optional(),
});

export const smartMenuCandidateSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    planId: uuid,
    dishId: uuid,
    dish: smartMenuDishSchema,
    recipeVariantId: uuid,
    recipeVariant: smartMenuVariantSchema,
    targetDate: dateOnly,
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    score: z.number().int(),
    reasons: z.array(z.string()),
    expiringIngredients: z.array(
      z
        .object({
          ingredientId: uuid,
          name: z.string(),
          expiresOn: dateOnly,
          daysRemaining: z.number().int(),
        }),
    ),
    pollOptionId: uuid.nullable(),
    adoptedMenuId: uuid.nullable(),
    sortOrder: z.number().int(),
    voteCount: z.number().int(),
    createdAt: isoDateTime,
  });
export type SmartMenuCandidate = z.infer<typeof smartMenuCandidateSchema>;

export const smartMenuPlanSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    startsOn: dateOnly,
    endsOn: dateOnly,
    status: smartMenuPlanStatus,
    pollId: uuid.nullable(),
    pollStatus: z.enum(['open', 'closed']).nullable(),
    candidates: z.array(smartMenuCandidateSchema),
    createdById: uuid,
    createdBy: memberSchema,
    adoptedById: uuid.nullable(),
    adoptedBy: memberSchema.nullable(),
    adoptedAt: nullableDateTime,
    canCreatePoll: z.boolean(),
    canAdopt: z.boolean(),
    adoptedCount: z.number().int(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type SmartMenuPlan = z.infer<typeof smartMenuPlanSchema>;

export const createSmartMenuPlanBody = z.object({
  startsOn: dateOnly,
  idempotencyKey: z.string().min(1).max(120),
});
export const createSmartMenuPollBody = z.object({
  closesAt: isoDateOrDateTime.nullish(),
});
export const adoptSmartMenuPlanBody = z.object({
  idempotencyKey: z.string().min(1).max(120),
});

export const smartMenu = {
  list: defineEndpoint({
    method: 'GET',
    path: '/smart-menu-plans',
    summary: '最近 10 份智能菜单方案',
    response: z.array(smartMenuPlanSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/smart-menu-plans',
    summary: '按临期食材批次生成一周候选菜（幂等）',
    body: createSmartMenuPlanBody,
    response: smartMenuPlanSchema,
  }),
  createPoll: defineEndpoint({
    method: 'POST',
    path: '/smart-menu-plans/:id/poll',
    summary: '把候选菜发起为家庭投票',
    params: idParams,
    body: createSmartMenuPollBody,
    response: smartMenuPlanSchema,
  }),
  adopt: defineEndpoint({
    method: 'POST',
    path: '/smart-menu-plans/:id/adopt',
    summary: '投票结束后把得票候选写入菜单（幂等）',
    params: idParams,
    body: adoptSmartMenuPlanBody,
    response: smartMenuPlanSchema,
  }),
};
