import { addDays, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import {
  boundedInteger,
  dateOnly,
  defineTool,
  MAX_EXTENDED_RESULT_ITEMS,
  MAX_RESULT_ITEMS,
  type AgentToolDeps,
} from './context';

export const getMealPlanTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_meal_plan',
    description: '读取指定日期已有的家庭三餐菜单',
    kind: 'read',
    schema: z.object({
      date: z.string().optional(),
    }),
    async execute({ user }, input) {
      const date = dateOnly(input.date, todayInShanghai());
      const menus = await deps.facades.get('menus').listMenusOn(user.householdId, date);
      const mealOrder = { breakfast: 0, lunch: 1, dinner: 2 } as const;
      return menus
        .sort((left, right) => mealOrder[left.mealType] - mealOrder[right.mealType])
        .map((menu) => ({
          id: menu.id,
          date: menu.date,
          mealType: menu.mealType,
          status: menu.status,
          chefName: menu.chef?.name ?? null,
          items: menu.items
            .filter((item) => item.status !== 'rejected')
            .slice(0, MAX_RESULT_ITEMS)
            .map((item) => ({
              id: item.id,
              dishName: item.dish.name,
              status: item.status,
              requestedByName: item.requestedBy.name,
              assignedToName: item.assignedTo?.name ?? null,
            })),
          targetPath: `/kitchen?date=${menu.date}&mealType=${menu.mealType}`,
        }));
    },
  });

export const getDishPlanTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_dish_plan',
    description: '查询未来最多 30 天的点菜计划',
    kind: 'read',
    schema: z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      days: z.number().int().min(1).max(30).optional(),
    }),
    async execute({ user }, input) {
      const startDate = dateOnly(input.startDate, todayInShanghai());
      const days = boundedInteger(input.days, 7, 30, '查询天数');
      const dates = Array.from({ length: days }, (_, index) =>
        addDays(startDate, index),
      );
      const menus = deps.facades.get('menus');
      const menuGroups = await Promise.all(
        dates.map((date) => menus.listMenusOn(user.householdId, date)),
      );
      const plans = menuGroups
        .flat()
        .flatMap((menu) =>
          menu.items
            .filter((item) => item.status !== 'rejected')
            .map((item) => ({
              id: item.id,
              date: menu.date,
              mealType: menu.mealType,
              recipeName: item.dish.name,
              recipeId: item.dishId,
              recipeVariantId: item.recipeVariantId,
              status: item.status,
              requestedByMemberId: item.requestedById,
              targetPath: `/kitchen?date=${menu.date}&mealType=${menu.mealType}`,
              untrustedContent: true,
            })),
        );
      return {
        plans: plans.slice(0, MAX_EXTENDED_RESULT_ITEMS),
        total: plans.length,
      };
    },
  });

export const proposeMenuTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_menu',
    description: '生成指定日期和餐次的菜单点菜提案',
    kind: 'propose',
    schema: z.object({
      date: z.string(),
      mealType: z.enum(['breakfast', 'lunch', 'dinner']),
      items: z
        .array(
          z.object({
            dishId: z.string().uuid(),
            recipeVariantId: z.string().uuid().optional(),
            note: z.string().max(200).optional(),
          }),
        )
        .min(1)
        .max(12),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_menu', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
