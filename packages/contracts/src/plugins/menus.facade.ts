// 点菜门面（J1b）：实现在 apps/api/src/menus/menus.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：购物（按某天的菜生成购物清单）、小管家（查菜单与点菜安排；点菜提案的预览与确认后加菜）。
import type { AddMenuItemsBody, MealType } from '../menus';
import type { PluginActor, PluginTransaction } from './kernel';

/** 一道菜的一行食材。不合并：同一食材同一单位的合并、扣库存由购物自己做。 */
export interface MenuIngredientNeed {
  ingredientId: string;
  unit: string;
  quantity: number;
  isPantryStaple: boolean;
}

/** 某天某餐的菜单（小管家用到的字段），菜按点的先后。 */
export interface MenuDayView {
  id: string;
  date: string;
  mealType: MealType;
  status: string;
  chef?: { name: string } | null;
  items: {
    id: string;
    status: string;
    dishId: string;
    recipeVariantId: string | null;
    requestedById: string;
    dish: { name: string };
    requestedBy: { name: string };
    assignedTo?: { name: string } | null;
  }[];
}

export interface MenusFacade {
  /**
   * 某家某天已接受 / 在做的菜需要的食材，逐道菜逐行：有做法快照用快照，没有用菜谱当前的食材。
   * 在调用方的事务里读（购物生成清单时持有按日期的咨询锁）。
   */
  listIngredientNeeds(transaction: PluginTransaction, householdId: string, date: string): Promise<MenuIngredientNeed[]>;
  /** 某家某天已有的菜单（没有就是空数组，不会新建）。 */
  listMenusOn(householdId: string, date: string): Promise<MenuDayView[]>;
  /**
   * 小管家点菜提案的预览：这餐结束了抛 409、同一道菜点两次抛 409、菜停用或不存在抛 404、做法不存在 / 没有默认做法抛 404；
   * 返回每道菜「菜名（做法名）」。
   */
  previewOrder(householdId: string, date: string, mealType: MealType, input: AddMenuItemsBody): Promise<string[]>;
  /** 小管家点菜提案确认：在调用方的事务里找到或建这餐菜单并加菜（要 place_meal_order 能力），返回菜单 id。 */
  addItemsForAgent(transaction: PluginTransaction, date: string, mealType: MealType, input: AddMenuItemsBody, actor: PluginActor): Promise<string>;
}
