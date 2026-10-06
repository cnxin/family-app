// 位置门面（J1b）：实现在 apps/api/src/locations/locations.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：库存（物品默认位置、批次位置、确认入库放哪儿）、资产（资产放哪儿）。
import type { PluginTransaction } from './kernel';

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
}
