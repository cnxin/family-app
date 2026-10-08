import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MenuIngredientNeed, MenusFacade } from '@family/contracts';
import { In, type DataSource } from 'typeorm';
import { Dish, DishRecipeVariant, Menu } from '../entities';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import type { AddItemsDto, MenusService } from './menus.module';

/** 点菜门面的实现（J1b，接口见 contracts/plugins/menus.facade.ts），MenusModule 启动时注册。 */
export function menusFacade(menus: MenusService, dataSource: DataSource): MenusFacade {
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
    listMenusOn: (householdId, date) => menus.listExistingByDate(householdId, date),
    // 校验原样搬自小管家的点菜提案预览（agent-proposals.service.ts，J4.1）
    async previewOrder(householdId, date, mealType, input) {
      const existing = await dataSource.getRepository(Menu).findOneBy({ householdId, date, mealType });
      if (existing?.status === 'done') {
        throw new ConflictException('这餐已经结束，不能再生成点菜提案');
      }
      const dishIds = input.items.map((item) => item.dishId);
      if (new Set(dishIds).size !== dishIds.length) {
        throw new ConflictException('一次点菜中不能重复选择同一道菜');
      }
      const dishes = await dataSource.getRepository(Dish).find({
        where: { householdId, id: In(dishIds), isActive: true },
      });
      if (dishes.length !== dishIds.length) {
        throw new NotFoundException('菜品不存在或已经停用');
      }
      const variants = await dataSource.getRepository(DishRecipeVariant).find({
        where: { householdId, dishId: In(dishIds), isArchived: false },
      });
      return input.items.map((item) => {
        const dish = dishes.find((entry) => entry.id === item.dishId)!;
        const variant = item.recipeVariantId
          ? variants.find(
              (entry) =>
                entry.id === item.recipeVariantId && entry.dishId === item.dishId,
            )
          : variants.find((entry) => entry.dishId === item.dishId && entry.isDefault);
        if (!variant) {
          throw new NotFoundException(
            item.recipeVariantId ? '所选做法不存在' : '菜品缺少家庭默认做法',
          );
        }
        return `${dish.name}（${variant.name}）`;
      });
    },
    addItemsForAgent: (transaction, date, mealType, input, actor) =>
      menus.addItemsForAgent(date, mealType, input as AddItemsDto, actor, fromPluginTransaction(transaction)),
  };
}
