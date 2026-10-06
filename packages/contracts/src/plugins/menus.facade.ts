// 点菜门面（J1b）：实现在 apps/api/src/menus/menus.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：购物（按某天的菜生成购物清单）。
import type { PluginTransaction } from './kernel';

/** 一道菜的一行食材。不合并：同一食材同一单位的合并、扣库存由购物自己做。 */
export interface MenuIngredientNeed {
  ingredientId: string;
  unit: string;
  quantity: number;
  isPantryStaple: boolean;
}

export interface MenusFacade {
  /**
   * 某家某天已接受 / 在做的菜需要的食材，逐道菜逐行：有做法快照用快照，没有用菜谱当前的食材。
   * 在调用方的事务里读（购物生成清单时持有按日期的咨询锁）。
   */
  listIngredientNeeds(transaction: PluginTransaction, householdId: string, date: string): Promise<MenuIngredientNeed[]>;
}
