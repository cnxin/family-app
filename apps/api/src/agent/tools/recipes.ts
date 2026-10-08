import { z } from 'zod';
import {
  boundedInteger,
  defineTool,
  MAX_EXTENDED_RESULT_ITEMS,
  normalizedTerms,
  type AgentToolDeps,
} from './context';

const SEARCH_RECIPES_RUN_LIMIT = 2;
export const SEARCH_RECIPES_LIMIT_ERROR = 'recipe_search_limit_reached';

export const searchRecipesTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'search_recipes',
    description: '这是搜索家庭菜谱库的唯一途径；不得在未调用本工具的情况下回答任何涉及具体菜品的问题。按关键词、食材或分类搜索家庭菜谱；搜索无匹配时必须如实告知，不得根据模型自身知识虚构任何菜名或菜谱内容。用户以“这道菜”等词指代单个菜品、但既无具体菜名也无页面上下文时，不得猜测菜品或调用无条件搜索，应先追问具体菜名；“搜索不辣的家常菜”等范围查询应直接调用本工具。同一 run 内最多调用本工具 2 次；若前两次结果不满足需求，必须直接使用已有结果继续规划，不得继续搜索',
    kind: 'read',
    schema: z.object({
      query: z.string().max(80).optional(),
      ingredients: z.array(z.string().min(1).max(64)).max(10).optional(),
      tags: z.array(z.string().min(1).max(32)).max(10).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    async execute({ user, run }, input) {
      const searchCount = await deps.toolEvents.countBy({
        runId: run.id,
        toolName: 'search_recipes',
      });
      if (searchCount >= SEARCH_RECIPES_RUN_LIMIT) {
        return {
          error: SEARCH_RECIPES_LIMIT_ERROR,
          message:
            '本次对话已达菜谱搜索上限，请基于已有搜索结果继续规划',
          recipes: [],
          total: 0,
        };
      }
      const query =
        typeof input.query === 'string'
          ? input.query.trim().toLocaleLowerCase('zh-CN').slice(0, 80)
          : '';
      const ingredients = normalizedTerms(input.ingredients, 10);
      const tags = normalizedTerms(input.tags, 10);
      const limit = boundedInteger(
        input.limit,
        10,
        MAX_EXTENDED_RESULT_ITEMS,
        '返回条数',
      );
      const dishes = await deps.facades.get('recipes').listCatalog(user.householdId);
      const matches = dishes
        .map((dish) => {
          const variants = dish.variants;
          const ingredientNames = [
            ...dish.ingredientNames,
            ...variants.flatMap((variant) => variant.ingredientNames),
          ];
          const normalizedIngredientNames = ingredientNames.map((name) =>
            name.toLocaleLowerCase('zh-CN'),
          );
          const haystack = [
            dish.name,
            dish.category,
            ...variants.map((variant) => variant.name),
            ...ingredientNames,
          ]
            .join('\n')
            .toLocaleLowerCase('zh-CN');
          if (query && !haystack.includes(query)) return null;
          if (
            ingredients.some(
              (term) =>
                !normalizedIngredientNames.some((name) => name.includes(term)),
            )
          ) {
            return null;
          }
          const category = dish.category.toLocaleLowerCase('zh-CN');
          if (tags.some((tag) => !category.includes(tag))) return null;
          const preferredVariant =
            variants.find((variant) => variant.isDefault) ?? variants[0];
          return {
            id: dish.id,
            name: dish.name,
            category: dish.category,
            cookingTime: preferredVariant?.estMinutes ?? dish.estMinutes,
            difficulty: dish.difficulty,
            tags: [dish.category],
            ingredients: [...new Set(ingredientNames)].slice(0, 20),
            defaultRecipeVariantId: preferredVariant?.id ?? null,
            targetPath: `/kitchen?dishId=${dish.id}`,
            untrustedContent: true,
          };
        })
        .filter((dish): dish is NonNullable<typeof dish> => dish != null);
      return { recipes: matches.slice(0, limit), total: matches.length };
    },
  });
