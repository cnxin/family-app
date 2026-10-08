// 购物门面（J1b）：实现在 apps/api/src/shopping/shopping.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：智能家居（滤芯低时看清单里是不是已经有没买的滤芯）、小管家（查清单、每周回顾、购物提案确认后加项）。
import type { ManualShoppingItemBody } from '../shopping';
import type { PluginTransaction } from './kernel';

/** 某天清单里的一项（小管家用到的字段）。totalQty 是数据库里的 decimal 字符串。 */
export interface ShoppingListItemView {
  id: string;
  date: string;
  customName: string | null;
  ingredient?: { name: string } | null;
  totalQty: string | null;
  unit: string | null;
  checked: boolean;
  source: string;
  inventoryItemId: string | null;
}

export interface ShoppingFacade {
  /** 购物清单里有没有这个名字、还没勾掉的项（不分日期、来源）。在调用方的事务里读。 */
  hasUncheckedItem(transaction: PluginTransaction, householdId: string, customName: string): Promise<boolean>;
  /** 与 GET /shopping?date 同一个实现：某天的购物清单。 */
  listItems(householdId: string, date: string): Promise<ShoppingListItemView[]>;
  /** 与手动加购物项同一个实现，在调用方的事务里写（小管家购物提案确认）。 */
  addManualItem(transaction: PluginTransaction, householdId: string, input: ManualShoppingItemBody): Promise<{ id: string }>;
}
