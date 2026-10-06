// 购物门面（J1b）：实现在 apps/api/src/shopping/shopping.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：智能家居（滤芯低时看清单里是不是已经有没买的滤芯）。
import type { PluginTransaction } from './kernel';

export interface ShoppingFacade {
  /** 购物清单里有没有这个名字、还没勾掉的项（不分日期、来源）。在调用方的事务里读。 */
  hasUncheckedItem(transaction: PluginTransaction, householdId: string, customName: string): Promise<boolean>;
}
