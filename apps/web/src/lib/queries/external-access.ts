import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExternalAccessDeviceDetail,
  ExternalAccessDeviceList,
  ExternalAccessOverview,
  ExternalAccessSession,
  ExternalAccessSettings,
  ExternalAccessTestResult,
  TestExternalAccessSettingsBody,
  UpdateExternalAccessSettingsBody,
} from '@family/contracts';
import { api } from '../api';
import { invalidateModules } from './modules';

export const externalAccessKeys = {
  settings: ['external-access-settings'] as const,
  overview: ['external-access-overview'] as const,
  devices: ['external-access-devices'] as const,
  device: (id: string) => ['external-access-device', id] as const,
  session: ['external-access-session'] as const,
};

export function useExternalAccessSettings(enabled = true) {
  return useQuery({
    queryKey: externalAccessKeys.settings,
    queryFn: () => api<ExternalAccessSettings>('/external-access/settings'),
    enabled,
  });
}

export function useExternalAccessOverview(enabled = true) {
  return useQuery({
    queryKey: externalAccessKeys.overview,
    queryFn: () => api<ExternalAccessOverview>('/external-access/overview'),
    enabled,
  });
}

export function useExternalAccessDevices(enabled = true) {
  return useQuery({
    queryKey: externalAccessKeys.devices,
    queryFn: () => api<ExternalAccessDeviceList>('/external-access/devices'),
    enabled,
  });
}

export function useExternalAccessDevice(id: string | null) {
  return useQuery({
    queryKey: externalAccessKeys.device(id ?? ''),
    queryFn: () => api<ExternalAccessDeviceDetail>(`/external-access/devices/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useExternalAccessSession(enabled = true) {
  return useQuery({
    queryKey: externalAccessKeys.session,
    queryFn: () => api<ExternalAccessSession>('/external-access/session'),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useRefreshExternalAccessOverview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<ExternalAccessOverview>('/external-access/overview?refresh=true'),
    onSuccess: (overview) => {
      client.setQueryData(externalAccessKeys.overview, overview);
      void client.invalidateQueries({ queryKey: externalAccessKeys.devices });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useSaveExternalAccessSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateExternalAccessSettingsBody) =>
      api<ExternalAccessSettings>('/external-access/settings', { method: 'PUT', body }),
    onSuccess: (settings) => {
      client.setQueryData(externalAccessKeys.settings, settings);
      void client.invalidateQueries({ queryKey: externalAccessKeys.overview });
      void client.invalidateQueries({ queryKey: externalAccessKeys.devices });
      void invalidateModules(client);
    },
  });
}

export function useResetExternalAccessSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<ExternalAccessSettings>('/external-access/settings', { method: 'DELETE' }),
    onSuccess: (settings) => {
      client.setQueryData(externalAccessKeys.settings, settings);
      void client.invalidateQueries({ queryKey: externalAccessKeys.overview });
      void client.invalidateQueries({ queryKey: externalAccessKeys.devices });
      void invalidateModules(client);
    },
  });
}

export function useTestExternalAccessSettings() {
  return useMutation({
    mutationFn: (body: TestExternalAccessSettingsBody = {}) =>
      api<ExternalAccessTestResult>('/external-access/settings/test', { method: 'POST', body }),
  });
}
