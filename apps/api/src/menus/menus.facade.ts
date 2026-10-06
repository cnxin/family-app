import type { MenuIngredientNeed, MenusFacade } from '@family/contracts';
import { Menu } from '../entities';
import { fromPluginTransaction } from '../system/plugin-facades.registry';

/** 点菜门面的实现（J1b，接口见 contracts/plugins/menus.facade.ts），MenusModule 启动时注册。 */
export function menusFacade(): MenusFacade {
  return {
    async listIngredientNeeds(transaction, householdId, date) {
      const menus = await fromPluginTransaction(transaction).getRepository(Menu).find({
        where: { householdId, date },
        relations: { items: { dish: { ingredients: { ingredient: true } } } },
      });
      return menus
        .flatMap((menu) => menu.items)
        .filter((item) => item.status === 'accepted' || item.status === 'cooking')
        .flatMap((item): MenuIngredientNeed[] =>
          item.recipeSnapshot
            ? item.recipeSnapshot.ingredients.map((ingredient) => ({
                ingredientId: ingredient.ingredientId,
                unit: ingredient.unit,
                quantity: ingredient.quantity,
                isPantryStaple: ingredient.isPantryStaple,
              }))
            : (item.dish.ingredients ?? []).map((dishIngredient) => ({
                ingredientId: dishIngredient.ingredientId,
                unit: dishIngredient.unit,
                quantity: Number(dishIngredient.quantity),
                isPantryStaple: dishIngredient.ingredient.isPantryStaple,
              })),
        );
    },
  };
}
