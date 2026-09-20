import type { QueryClient } from '@tanstack/react-query';
import type {
  AuthSession, BackupDashboard, FinanceSummary, HomeAsset, HouseholdPoll,
  InventoryBatch, RewardRedemption, TravelPlan, Visit,
} from '@family/contracts';
import { api } from './api';
import { monthNow } from './queries/finance';

/**
 * 留意区的数据预热，不是图块状态的数据加载器。只在导航意图发生时调用；
 * F5 复用这些现有 hook 的键，不能为每个 shelf 再拉一份列表。
 * visits 已含点菜请求；按来访日期核对菜单由 F5 消费者按需处理。
 */
export function prefetchAttention(client: QueryClient, member: AuthSession['member']) {
  const warm = <T>(queryKey: readonly unknown[], path: string) => {
    void client.prefetchQuery({ queryKey, queryFn: () => api<T>(path) });
  };
  warm<HomeAsset[]>(['assets', 'all'], '/assets?status=all');
  warm<Visit[]>(['visits'], '/visits');
  warm<TravelPlan[]>(['travel-plans', 'active'], '/travel-plans?status=active');
  warm<InventoryBatch[]>(['inventory-batches', 'active', 7], '/inventory-batches?status=active&days=7');
  warm<HouseholdPoll[]>(['polls'], '/polls?status=all');
  if (member.role !== 'owner' && member.role !== 'admin') return;
  const month = monthNow();
  warm<RewardRedemption[]>(['reward-redemptions'], '/reward-redemptions');
  warm<FinanceSummary>(['finance', 'summary', month], `/finance/summary?month=${month}`);
  warm<BackupDashboard>(['backup-dashboard'], '/system/backups');
}
