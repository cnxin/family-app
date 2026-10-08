import type { LocationsFacade } from '@family/contracts';
import type { DataSource } from 'typeorm';
import { StorageLocation } from '../entities';
import { fromPluginTransaction } from '../system/plugin-facades.registry';
import { findItemLocations, readLocationContents } from './location-find';
import { usableLocationId } from './location-refs';
import { placeTree, subtreeIds } from './location-tree';

/** 位置门面的实现（J1b，接口见 contracts/plugins/locations.facade.ts），LocationsModule 启动时注册。 */
export function locationsFacade(dataSource: DataSource): LocationsFacade {
  const placed = async (householdId: string) =>
    placeTree(await dataSource.manager.getRepository(StorageLocation).find({ where: { householdId } }));
  return {
    usableLocationId: (transaction, householdId, locationId) =>
      usableLocationId(fromPluginTransaction(transaction), householdId, locationId),
    // 下面三个给小管家的 find_item / list_location_contents（J4.1，原来在 agent-location-tools.ts 直接调本目录的纯函数）
    findItemLocations: async (householdId, query) =>
      findItemLocations(dataSource.manager, householdId, query, await placed(householdId)),
    listLocationPaths: async (householdId) =>
      (await placed(householdId)).map((one) => ({
        id: one.row.id,
        name: one.row.name,
        pathLabel: one.pathLabel,
        archived: Boolean(one.row.archivedAt),
      })),
    async listContents(householdId, locationId) {
      const rows = (await placed(householdId)).filter((one) => !one.row.archivedAt).map((one) => one.row);
      return readLocationContents(dataSource.manager, householdId, subtreeIds(rows, locationId));
    },
  };
}
