// 位置门面（J1b）：实现在 apps/api/src/locations/locations.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：库存（物品默认位置、批次位置、确认入库放哪儿）、资产（资产放哪儿）、小管家（找东西、某个位置里有什么）。
import type { ItemLocationHit, StorageLocationContents } from '../locations';
import type { PluginTransaction } from './kernel';

/** 一个位置在树里的路径（「客厅 / 电视柜 / 第二层」）。 */
export interface LocationPathView {
  id: string;
  name: string;
  pathLabel: string;
  archived: boolean;
}

export interface LocationsFacade {
  /**
   * 引用位置前的检查：必须是这个家庭的、没归档的位置，否则抛 404「这个位置不存在」/ 400「这个位置已经归档了，换一个」。
   * undefined = 调用方没提这个字段，null = 清掉，都原样返回。在调用方的事务里读。
   */
  usableLocationId(
    transaction: PluginTransaction,
    householdId: string,
    locationId: string | null | undefined,
  ): Promise<string | null | undefined>;
  /** 与「找东西」同一个实现：名字匹配的库存物品、批次、资产上次放在哪（含已归档位置下的）。 */
  findItemLocations(householdId: string, query: string): Promise<ItemLocationHit[]>;
  /** 全部位置（含已归档），按树的先序。 */
  listLocationPaths(householdId: string): Promise<LocationPathView[]>;
  /** 某个位置及其没归档的子位置里记着的批次、物品、资产。 */
  listContents(householdId: string, locationId: string): Promise<Omit<StorageLocationContents, 'location'>>;
}
