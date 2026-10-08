// 资产门面（K3）：实现在 apps/api/src/assets/assets.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：财务（汇总页「固定支出」里的资产续费月均）、小管家（单件资产详情）。

/** 单件资产（小管家用到的字段）。 */
export interface AssetDetailView {
  id: string;
  name: string;
  category: string;
  status: string;
  location: string | null;
  brand: string | null;
  model: string | null;
  purchaseDate: string | null;
  warrantyExpiresOn: string | null;
  maintenancePlans: { isEnabled: boolean; nextDueDate: string }[];
}

export interface AssetsFacade {
  /**
   * 在用的「订阅」类资产按续费周期折成每月多少钱：每次续费金额（K 收尾加的 renewalPrice，没填就用购买价格）
   * ÷ 续费间隔月数，两位小数。两个价格都没登记、或没有续费周期的不算。
   */
  monthlyRecurringCost(householdId: string): Promise<number>;
  /** 与 GET /assets/:id 同一个实现；不是这个家庭的或不存在抛 404「家庭资产不存在」。 */
  getAsset(householdId: string, assetId: string): Promise<AssetDetailView>;
}
