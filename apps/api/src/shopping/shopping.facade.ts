import type { ShoppingFacade } from '@family/contracts';
import { ShoppingItem } from '../entities';
import { fromPluginTransaction } from '../system/plugin-facades.registry';

/** 购物门面的实现（J1b，接口见 contracts/plugins/shopping.facade.ts），ShoppingModule 启动时注册。 */
export function shoppingFacade(): ShoppingFacade {
  return {
    async hasUncheckedItem(transaction, householdId, customName) {
      const count = await fromPluginTransaction(transaction)
        .getRepository(ShoppingItem)
        .count({ where: { householdId, customName, checked: false } });
      return count > 0;
    },
  };
}
