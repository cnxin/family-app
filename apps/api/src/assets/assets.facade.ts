import type { AssetsFacade } from '@family/contracts';
import type { DataSource } from 'typeorm';

/** 资产门面的实现（K3，接口见 contracts/plugins/assets.facade.ts），AssetsModule 启动时注册。 */
export function assetsFacade(dataSource: DataSource): AssetsFacade {
  return {
    async monthlyRecurringCost(householdId) {
      const [row]: { monthly: string }[] = await dataSource.query(
        // 每次续费金额优先，没填退回购买价格，都没有的不算
        `SELECT COALESCE(SUM(COALESCE("renewalPrice", "purchasePrice") / "renewalIntervalMonths"), 0) AS monthly
           FROM home_assets
          WHERE "householdId" = $1
            AND category = 'subscription'
            AND status = 'active'
            AND "renewalIntervalMonths" IS NOT NULL
            AND COALESCE("renewalPrice", "purchasePrice") IS NOT NULL`,
        [householdId],
      );
      return Math.round(Number(row.monthly) * 100) / 100;
    },
  };
}
