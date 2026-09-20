import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** 精确匹配完整列表键；不把筛选结果当总数，也不把缓存缺失当成零。 */
const LISTS: Record<string, { key: QueryKey; unit: string }> = {
  recipes: { key: ['recipes'], unit: '道菜谱' },
  reminders: { key: ['reminders', 'all'], unit: '条提醒' },
  polls: { key: ['polls'], unit: '个投票' },
  inventory: { key: ['inventory'], unit: '项库存' },
  assets: { key: ['assets', 'all'], unit: '件资产' },
  guests: { key: ['visits'], unit: '次来访' },
  travel: { key: ['travel-plans', 'active'], unit: '个进行中行程' },
};

function cachedStatus(client: QueryClient, key: string) {
  const list = LISTS[key];
  if (!list) return undefined;
  const state = client.getQueryState<unknown[]>(list.key);
  if (state?.status !== 'success' || !state.data) return undefined;
  // 资产等列表有后端上限，「已载入」不冒充家庭总数或待处理事项。
  return `已载入 ${state.data.length} ${list.unit}`;
}

/** 只订阅 QueryCache，不创建查询观察者、不挂载域 hook、不触发网络请求。 */
export function useHomeStatus(key: string) {
  const client = useQueryClient();
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]);
  // 字符串/undefined 是稳定快照，不能在 getSnapshot 里每次返回一个新对象。
  const snapshot = useCallback(() => cachedStatus(client, key), [client, key]);
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
