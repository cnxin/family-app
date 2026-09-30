import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSmartHomeLinkBody,
  SmartHomeHistory,
  SmartHomeLink,
  SmartHomeMergeReport,
  SmartHomePanel,
  UpdateSmartHomeLinkBody,
  SmartHomeAction,
  SmartHomeCommand,
  SmartHomeCommandSource,
  SmartHomeConnection,
  SmartHomeConnectorSettings,
  SmartHomeDevice,
  SmartHomeDirectory,
  SmartHomeRules,
  SmartHomeStates,
  SmartHomeWebhookEventRecord,
  SmartHomeWebhookSecret,
  SmartHomeWebhookSettings,
  AddSmartHomeDeviceBody,
  UpdateSmartHomeConnectorBody,
  UpdateSmartHomeDeviceBody,
} from '@family/contracts';
import { api } from '../api';
import { newId } from '../ids';
import { invalidateModules } from './modules';

// 智能家居（H3）：状态由服务端去 HA 取（3 秒超时），这里不轮询；
// HA 的状态变化由服务端订阅后经 /events 的 smart-home 域推过来（E2）。

export const smartHomeKeys = {
  states: ['smart-home-states'] as const,
  devices: ['smart-home-devices'] as const,
  directory: ['smart-home-directory'] as const,
  settings: ['smart-home-connector-settings'] as const,
  commands: ['smart-home-commands'] as const,
  /** 详情面板：['smart-home-panel', 设备 id]；HA 状态一变经 /events 整组失效重取 */
  panel: (id: string) => ['smart-home-panel', id] as const,
  /** 24 小时趋势，服务端缓存 5 分钟，这边不跟着 /events 刷 */
  history: (id: string, entityId: string) => ['smart-home-history', id, entityId] as const,
  mergeReport: ['smart-home-merge-report'] as const,
};

/** enabled：今天页、家里页在智能家居分段没开时不去读 HA */
export function useSmartHomeStates(enabled = true) {
  return useQuery({
    queryKey: smartHomeKeys.states,
    queryFn: () => api<SmartHomeStates>('/smart-home/states'),
    enabled,
  });
}

/**
 * 只读缓存、自己不发请求：家里页的规矩是状态行只来自留意、不为图块拉列表（home.spec 钉着）。
 * 今天页「家里的设备」读过一次，这里就有；/events 推来变化时今天页那边会刷新同一份缓存。
 */
export function useCachedSmartHomeStates() {
  return useQuery({
    queryKey: smartHomeKeys.states,
    queryFn: () => api<SmartHomeStates>('/smart-home/states'),
    enabled: false,
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
      for (const key of Object.values(smartHomeKeys)) {
        // 函数型的键（面板、趋势）按前缀失效
        void client.invalidateQueries({ queryKey: typeof key === 'function' ? [key('', '')[0]] : key });
      }
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

/** 目录里「加进来」：整台 HA 设备（或一个没有归属设备的实体），默认搭配由服务端算。 */
export function useAddSmartHomeDevice() {
  return useSmartHomeMutation((body: AddSmartHomeDeviceBody) =>
    api<SmartHomeDevice>('/smart-home/devices', { method: 'POST', body }),
  );
}

export function useUpdateSmartHomeDevice() {
  return useSmartHomeMutation(({ id, body }: { id: string; body: UpdateSmartHomeDeviceBody }) =>
    api<SmartHomeDevice>(`/smart-home/devices/${id}`, { method: 'PATCH', body }),
  );
}

export function useRemoveSmartHomeDevice() {
  return useSmartHomeMutation((id: string) => api<{ id: string }>(`/smart-home/devices/${id}`, { method: 'DELETE' }));
}

/** E2 控制。requestId 是这一次点击的幂等键：网络重发不会让 HA 执行两次。失败的提示由全局 mutation 错误处理弹。 */
export function useSmartHomeCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, action }: { deviceId: string; action: SmartHomeAction }) =>
      api<SmartHomeCommand>(`/smart-home/devices/${deviceId}/command`, {
        method: 'POST',
        body: { action, requestId: newId() },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: smartHomeKeys.states });
      void client.invalidateQueries({ queryKey: smartHomeKeys.commands });
    },
  });
}

/** 一台设备的完整控制面板（R1b）。打开详情时才读。 */
export function useSmartHomePanel(id: string | null) {
  return useQuery({
    queryKey: smartHomeKeys.panel(id ?? ''),
    queryFn: () => api<SmartHomePanel>(`/smart-home/devices/${id}/panel`),
    enabled: Boolean(id),
  });
}

export function useSmartHomeHistory(id: string, entityId: string | null) {
  return useQuery({
    queryKey: smartHomeKeys.history(id, entityId ?? ''),
    queryFn: () =>
      api<SmartHomeHistory>(`/smart-home/devices/${id}/history?entityId=${encodeURIComponent(entityId ?? '')}`),
    enabled: Boolean(entityId),
    staleTime: 5 * 60_000,
  });
}

/**
 * 详情面板里的一次控制（子实体、带值）。requestId 由调用方给（usePendingCommands 管锁和幂等键）；
 * 失败的提示由全局 mutation 错误处理弹。
 */
export function useSmartHomeEntityCommand(deviceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { entityId: string; action: SmartHomeAction; value?: string | number | string[]; requestId: string }) =>
      api<SmartHomeCommand>(`/smart-home/devices/${deviceId}/command`, { method: 'POST', body }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: smartHomeKeys.panel(deviceId) });
      void client.invalidateQueries({ queryKey: smartHomeKeys.states });
    },
  });
}

/** 最近一次「按实体 → 按设备」归并的结果（管理员；没归并过为 null）。 */
export function useSmartHomeMergeReport(enabled: boolean) {
  return useQuery({
    queryKey: smartHomeKeys.mergeReport,
    queryFn: () => api<SmartHomeMergeReport | null>('/smart-home/devices/merge-report'),
    enabled,
  });
}

/** 最近 50 次控制（管理员）；source 只看手按 / 联动按的（E5）。键以 commands 开头，/events 按前缀一起失效。 */
export function useSmartHomeCommands(enabled: boolean, source?: SmartHomeCommandSource) {
  return useQuery({
    queryKey: [...smartHomeKeys.commands, source ?? 'all'],
    queryFn: () => api<SmartHomeCommand[]>(`/smart-home/commands${source ? `?source=${source}` : ''}`),
    enabled,
  });
}

// ---- E3：HA → 小管家 ----------------------------------------------------------------------------

export const smartHomeWebhookKeys = {
  settings: ['smart-home-webhook'] as const,
  events: ['smart-home-webhook-events'] as const,
};

export function useSmartHomeWebhookSettings() {
  return useQuery({
    queryKey: smartHomeWebhookKeys.settings,
    queryFn: () => api<SmartHomeWebhookSettings>('/smart-home/webhook-settings'),
  });
}

export function useSmartHomeWebhookEvents(enabled = true) {
  return useQuery({
    queryKey: smartHomeWebhookKeys.events,
    queryFn: () => api<SmartHomeWebhookEventRecord[]>('/smart-home/webhook-settings/events'),
    enabled,
  });
}

function useWebhookMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: smartHomeWebhookKeys.settings });
      void client.invalidateQueries({ queryKey: smartHomeWebhookKeys.events });
    },
  });
}

/** 生成 / 轮换密钥：明文只在返回里出现这一次，拿去生成 HA 配置。 */
export function useRotateSmartHomeWebhook() {
  return useWebhookMutation<void, SmartHomeWebhookSecret>(() =>
    api<SmartHomeWebhookSecret>('/smart-home/webhook-settings/secret', { method: 'POST' }),
  );
}

export function useUpdateSmartHomeRules() {
  return useWebhookMutation((rules: SmartHomeRules) =>
    api<SmartHomeWebhookSettings>('/smart-home/webhook-settings/rules', { method: 'PUT', body: rules }),
  );
}

// ---- E4：小管家 → HA 的联动规则 --------------------------------------------------------------------

export const smartHomeLinksKey = ['smart-home-links'] as const;

export function useSmartHomeLinks() {
  return useQuery({ queryKey: smartHomeLinksKey, queryFn: () => api<SmartHomeLink[]>('/smart-home/links') });
}

function useLinkMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void client.invalidateQueries({ queryKey: smartHomeLinksKey }),
  });
}

export function useCreateSmartHomeLink() {
  return useLinkMutation((body: CreateSmartHomeLinkBody) =>
    api<SmartHomeLink>('/smart-home/links', { method: 'POST', body }),
  );
}

export function useUpdateSmartHomeLink() {
  return useLinkMutation(({ id, body }: { id: string; body: UpdateSmartHomeLinkBody }) =>
    api<SmartHomeLink>(`/smart-home/links/${id}`, { method: 'PATCH', body }),
  );
}

export function useDeleteSmartHomeLink() {
  return useLinkMutation((id: string) => api<{ id: string }>(`/smart-home/links/${id}`, { method: 'DELETE' }));
}
