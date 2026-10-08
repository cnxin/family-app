import type { RecipesFacade } from '@family/contracts';
import type { DataSource } from 'typeorm';
import { Dish } from '../entities';

/** 菜谱门面的实现（J4.1，接口见 contracts/plugins/recipes.facade.ts），RecipesModule 启动时注册。 */
export function recipesFacade(dataSource: DataSource): RecipesFacade {
  return {
    async listCatalog(householdId) {
      // 查询原样搬自小管家 search_recipes（食材的顺序就是连表读出的顺序）
      const dishes = await dataSource
        .getRepository(Dish)
        .createQueryBuilder('dish')
        .leftJoinAndSelect('dish.ingredients', 'dishIngredient')
        .leftJoinAndSelect('dishIngredient.ingredient', 'dishIngredientEntity')
        .leftJoinAndSelect('dish.recipeVariants', 'recipeVariant')
        .leftJoinAndSelect('recipeVariant.ingredients', 'variantIngredient')
        .leftJoinAndSelect('variantIngredient.ingredient', 'variantIngredientEntity')
        .where('dish.householdId = :householdId', { householdId })
        .andWhere('dish.isActive = true')
        .orderBy('dish.createdAt', 'DESC')
        .getMany();
      return dishes.map((dish) => ({
        id: dish.id,
        name: dish.name,
        category: dish.category,
        estMinutes: dish.estMinutes,
        difficulty: dish.difficulty,
        ingredientNames: (dish.ingredients ?? []).map((entry) => entry.ingredient.name),
        variants: (dish.recipeVariants ?? [])
          .filter((variant) => !variant.isArchived)
          .map((variant) => ({
            id: variant.id,
            name: variant.name,
            isDefault: variant.isDefault,
            estMinutes: variant.estMinutes,
            ingredientNames: (variant.ingredients ?? []).map((entry) => entry.ingredient.name),
          })),
      }));
    },
  };
}
