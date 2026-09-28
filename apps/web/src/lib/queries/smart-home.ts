import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SmartHomeConnection,
  SmartHomeConnectorSettings,
  SmartHomeDevice,
  SmartHomeDirectory,
  SmartHomeStates,
  UpdateSmartHomeConnectorBody,
  UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { api } from '../api';
import { invalidateModules } from './modules';

// 智能家居（H3 E1）：只读。状态由服务端去 HA 取（3 秒超时），这里不轮询；
// E2 起 HA 的状态变化经 /events 的 smart-home 域推过来。

export const smartHomeKeys = {
  states: ['smart-home-states'] as const,
  devices: ['smart-home-devices'] as const,
  directory: ['smart-home-directory'] as const,
  settings: ['smart-home-connector-settings'] as const,
};

export function useSmartHomeStates() {
  return useQuery({
    queryKey: smartHomeKeys.states,
    queryFn: () => api<SmartHomeStates>('/smart-home/states'),
  });
}

export function useSmartHomeDevices() {
  return useQuery({
    queryKey: smartHomeKeys.devices,
    queryFn: () => api<SmartHomeDevice[]>('/smart-home/devices'),
  });
}

export function useSmartHomeConnectorSettings(enabled = true) {
  return useQuery({
    queryKey: smartHomeKeys.settings,
    queryFn: () => api<SmartHomeConnectorSettings>('/smart-home/connector-settings'),
    enabled,
  });
}

/** 目录要等连接配好才有意义；列出 HA 上所有能挑的实体。 */
export function useSmartHomeDirectory(enabled: boolean) {
  return useQuery({
    queryKey: smartHomeKeys.directory,
    queryFn: () => api<SmartHomeDirectory>('/smart-home/entity-directory'),
    enabled,
    staleTime: 0,
  });
}

function useSmartHomeMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void invalidateModules(client);
      for (const key of Object.values(smartHomeKeys)) void client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSaveSmartHomeConnector() {
  return useSmartHomeMutation((body: UpdateSmartHomeConnectorBody) =>
    api<SmartHomeConnectorSettings>('/smart-home/connector-settings', { method: 'PUT', body }),
  );
}

export function useResetSmartHomeConnector() {
  return useSmartHomeMutation<void, SmartHomeConnectorSettings>(() =>
    api<SmartHomeConnectorSettings>('/smart-home/connector-settings', { method: 'DELETE' }),
  );
}

export function useTestSmartHomeConnector() {
  return useSmartHomeMutation<void, SmartHomeConnection>(() =>
    api<SmartHomeConnection>('/smart-home/connector-settings/test', { method: 'POST' }),
  );
}

export function useUpsertSmartHomeDevice() {
  return useSmartHomeMutation(({ entityId, body }: { entityId: string; body: UpsertSmartHomeDeviceBody }) =>
    api<SmartHomeDevice>(`/smart-home/devices/${encodeURIComponent(entityId)}`, { method: 'PUT', body }),
  );
}

export function useRemoveSmartHomeDevice() {
  return useSmartHomeMutation((entityId: string) =>
    api<{ entityId: string }>(`/smart-home/devices/${encodeURIComponent(entityId)}`, { method: 'DELETE' }),
  );
}
