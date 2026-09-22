import type { QueryClient } from '@tanstack/react-query';
import type { AuthSession, TodayAttention } from '@family/contracts';
import { api } from './api';


/**
 * 留意区的数据预热，不是图块状态的数据加载器。只在导航意图发生时调用；
 * F5 复用这些现有 hook 的键，不能为每个 shelf 再拉一份列表。
 * visits 已含点菜请求；按来访日期核对菜单由 F5 消费者按需处理。
 */
export function prefetchAttention(client: QueryClient, session: AuthSession) {
  if (!session) return;
  void client.prefetchQuery({ queryKey: ['today', 'attention'], queryFn: () => api<TodayAttention>('/today/attention') });
}
