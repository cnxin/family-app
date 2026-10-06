import type { LocationsFacade } from '@family/contracts';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import { usableLocationId } from './location-refs';

/** 位置门面的实现（J1b，接口见 contracts/plugins/locations.facade.ts），LocationsModule 启动时注册。 */
export function locationsFacade(): LocationsFacade {
  return {
    usableLocationId: (transaction, householdId, locationId) =>
      usableLocationId(fromPluginTransaction(transaction), householdId, locationId),
  };
}
