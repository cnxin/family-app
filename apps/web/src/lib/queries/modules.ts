import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { systemModulesSchema, type ModuleOverride, type ShelfModuleKey, type SystemModuleState } from '@family/contracts';
import { api } from '../api';
import { useAuth } from '../auth';

export const modulesKey = ['system', 'modules'] as const;
interface ModulesCache { householdId: string; modules: SystemModuleState[] }

/** 所有影响 F3 hasData 的写操作都经过这里；失效会刷新外壳的常驻订阅。 */
export function invalidateModules(client: QueryClient) {
  return client.invalidateQueries({ queryKey: modulesKey });
}

export function useModules() {
  const { session } = useAuth();
  const householdId = session?.member.householdId ?? '';
  const client = useQueryClient();
  const query = useQuery({
    queryKey: modulesKey,
    queryFn: async (): Promise<ModulesCache> => ({
      householdId,
      ...systemModulesSchema.parse(await api('/system/modules')),
    }),
    enabled: Boolean(householdId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // 缓存键按计划固定；换家庭不能借用上一家的 override。
  const sameHousehold = query.data?.householdId === householdId;
  useEffect(() => {
    if (query.data && !sameHousehold) void invalidateModules(client);
  }, [client, query.data, sameHousehold]);
  const states = sameHousehold ? query.data?.modules : undefined;
  const state = (key: string) => states?.find((entry) => entry.key === key);
  return {
    ...query,
    initialLoading: !query.isError && !states,
    state,
    // 错误优先于旧缓存：即使缓存里 off，也必须放行。
    visible: (key: string) => {
      if (query.isError) return true;
      const entry = state(key);
      return !entry || entry.override === 'on' || (entry.override !== 'off' && entry.hasData);
    },
    // F5 只用主动 off 抑制卡片，不能拿 visible 代替。
    explicitlyHidden: (key: string) => !query.isError && state(key)?.override === 'off',
  };
}

export function useSetModuleOverride() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, override }: { key: ShelfModuleKey; override: ModuleOverride }) =>
      api<SystemModuleState>(`/system/modules/${key}`, { method: 'PATCH', body: { override } }),
    onSuccess: () => invalidateModules(client),
  });
}
