// 资产门面（K3）：实现在 apps/api/src/assets/assets.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：财务（汇总页「固定支出」里的资产续费月均）。

export interface AssetsFacade {
  /**
   * 在用的「订阅」类资产按续费周期折成每月多少钱：每次续费金额（K 收尾加的 renewalPrice，没填就用购买价格）
   * ÷ 续费间隔月数，两位小数。两个价格都没登记、或没有续费周期的不算。
   */
  monthlyRecurringCost(householdId: string): Promise<number>;
}
