import { z } from 'zod';
import { isoDateTime, nullableDateTime } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/external-access/（M5-E 阶段 1：Tailscale 控制面只读面板 + 入口识别）。
// 方案见 docs/external-access-plan.md §5。
//
// 安全约束：
// - 控制面凭据（OAuth client secret 或 API 令牌）加密存库或走 /run/integration-secrets/ 文件，只写不读；
// - 响应永远不回传 machineKey / nodeKey / tailnetLockKey / 登录链接 / 凭据明文或密文；
// - 设备 addresses 只在明细接口给，不进概览列表；
// - /external-access/session 对非管理员隐藏 login。

export const EXTERNAL_ACCESS_MODES = ['household', 'server_default'] as const;
export const externalAccessMode = z.enum(EXTERNAL_ACCESS_MODES);
export type ExternalAccessMode = z.infer<typeof externalAccessMode>;

export const EXTERNAL_ACCESS_CREDENTIAL_KINDS = ['oauth_client', 'api_token'] as const;
export const externalAccessCredentialKind = z.enum(EXTERNAL_ACCESS_CREDENTIAL_KINDS);
export type ExternalAccessCredentialKind = z.infer<typeof externalAccessCredentialKind>;

export const EXTERNAL_ACCESS_ACCESS_SCOPES = ['household', 'server_default', 'restricted'] as const;
export const externalAccessAccessScope = z.enum(EXTERNAL_ACCESS_ACCESS_SCOPES);
export type ExternalAccessAccessScope = z.infer<typeof externalAccessAccessScope>;

export const EXTERNAL_ACCESS_PERMISSION_LEVELS = ['read_only', 'read_write', 'unknown'] as const;
export const externalAccessPermissionLevel = z.enum(EXTERNAL_ACCESS_PERMISSION_LEVELS);
export type ExternalAccessPermissionLevel = z.infer<typeof externalAccessPermissionLevel>;

export const EXTERNAL_ACCESS_ALERT_KINDS = ['key_expiring', 'stale_offline'] as const;
export const externalAccessAlertKind = z.enum(EXTERNAL_ACCESS_ALERT_KINDS);
export type ExternalAccessAlertKind = z.infer<typeof externalAccessAlertKind>;

export const externalAccessDeviceParams = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/, '设备 ID 格式不对'),
});

export const externalAccessOverviewQuery = z.object({
  refresh: z.enum(['true', 'false']).optional(),
});
export type ExternalAccessOverviewQuery = z.infer<typeof externalAccessOverviewQuery>;

// ---- 设置与测试 ----------------------------------------------------------------

/** 外部访问连接设置：凭据只写不读，多家庭受限时隐藏服务器默认配置细节。 */
export const externalAccessSettingsSchema = z.object({
  mode: externalAccessMode,
  accessScope: externalAccessAccessScope,
  accessMessage: z.string().nullable(),
  isEnabled: z.boolean(),
  baseUrl: z.string().nullable(),
  tailnet: z.string().nullable(),
  publicUrl: z.string().nullable(),
  nodeHostname: z.string().nullable(),
  credentialKind: externalAccessCredentialKind.nullable(),
  oauthClientIdHint: z.string().nullable(),
  credentialConfigured: z.boolean(),
  credentialHint: z.string().nullable(),
  configured: z.boolean(),
  corsOriginMatched: z.boolean().nullable(),
  updatedAt: nullableDateTime,
});
export type ExternalAccessSettings = z.infer<typeof externalAccessSettingsSchema>;

export const updateExternalAccessSettingsBody = z
  .object({
    isEnabled: z.boolean().optional(),
    baseUrl: z.string().max(2000).nullable().optional(),
    tailnet: z.string().max(200).nullable().optional(),
    publicUrl: z.string().max(2000).nullable().optional(),
    nodeHostname: z.string().max(120).nullable().optional(),
    credentialKind: externalAccessCredentialKind.optional(),
    oauthClientId: z.string().max(200).nullable().optional(),
    credential: z.string().max(2000).optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict();
export type UpdateExternalAccessSettingsBody = z.infer<typeof updateExternalAccessSettingsBody>;

export const testExternalAccessSettingsBody = z
  .object({
    baseUrl: z.string().max(2000).nullable().optional(),
    tailnet: z.string().max(200).nullable().optional(),
    nodeHostname: z.string().max(120).nullable().optional(),
    credentialKind: externalAccessCredentialKind.optional(),
    oauthClientId: z.string().max(200).nullable().optional(),
    credential: z.string().max(2000).optional(),
  })
  .strict();
export type TestExternalAccessSettingsBody = z.infer<typeof testExternalAccessSettingsBody>;

export const externalAccessTestResultSchema = z.object({
  ok: z.boolean(),
  available: z.boolean(),
  readOnlyVerified: z.boolean(),
  permissionLevel: externalAccessPermissionLevel,
  checkedAt: isoDateTime,
  message: z.string(),
  deviceCount: z.number().int().min(0).nullable(),
  matchedNodeName: z.string().nullable(),
  credentialKind: externalAccessCredentialKind.nullable(),
});
export type ExternalAccessTestResult = z.infer<typeof externalAccessTestResultSchema>;

// ---- 节点、设备与概览 -----------------------------------------------------------

export const externalAccessConnectionSchema = z.object({
  configured: z.boolean(),
  available: z.boolean(),
  checkedAt: isoDateTime,
  message: z.string(),
  cached: z.boolean(),
});
export type ExternalAccessConnection = z.infer<typeof externalAccessConnectionSchema>;

/** 列表用设备摘要：不含 addresses 与任何密钥字段。 */
export const externalAccessDeviceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hostname: z.string(),
  user: z.string().nullable(),
  os: z.string().nullable(),
  clientVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  authorized: z.boolean(),
  connectedToControl: z.boolean(),
  isExternal: z.boolean(),
  isServerNode: z.boolean(),
  lastSeen: nullableDateTime,
  expires: nullableDateTime,
  keyExpiryDisabled: z.boolean(),
  expiresInDays: z.number().int().nullable(),
  offlineDays: z.number().int().min(0).nullable(),
});
export type ExternalAccessDeviceSummary = z.infer<typeof externalAccessDeviceSummarySchema>;

/** 设备明细：在摘要基础上补充 Tailscale 地址、标签与创建时间（仍不含任何密钥）。 */
export const externalAccessDeviceDetailSchema = externalAccessDeviceSummarySchema.extend({
  addresses: z.array(z.string()),
  tags: z.array(z.string()),
  blocksIncomingConnections: z.boolean(),
  created: nullableDateTime,
});
export type ExternalAccessDeviceDetail = z.infer<typeof externalAccessDeviceDetailSchema>;

export const externalAccessAlertSchema = z.object({
  kind: externalAccessAlertKind,
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  isServerNode: z.boolean(),
  dueOn: z.string().nullable(),
  daysRemaining: z.number().int().nullable(),
  offlineDays: z.number().int().min(0).nullable(),
  message: z.string(),
});
export type ExternalAccessAlert = z.infer<typeof externalAccessAlertSchema>;

export const externalAccessSummaryStatsSchema = z.object({
  totalDevices: z.number().int().min(0),
  onlineDevices: z.number().int().min(0),
  unauthorizedDevices: z.number().int().min(0),
  expiringSoonCount: z.number().int().min(0),
  staleOfflineCount: z.number().int().min(0),
  externalDevices: z.number().int().min(0),
});
export type ExternalAccessSummaryStats = z.infer<typeof externalAccessSummaryStatsSchema>;

export const externalAccessOverviewSchema = z.object({
  accessScope: externalAccessAccessScope,
  accessMessage: z.string().nullable(),
  connection: externalAccessConnectionSchema,
  publicUrl: z.string().nullable(),
  corsOriginMatched: z.boolean().nullable(),
  nodeHostname: z.string().nullable(),
  node: externalAccessDeviceSummarySchema.nullable(),
  summary: externalAccessSummaryStatsSchema,
  devices: z.array(externalAccessDeviceSummarySchema),
  alerts: z.array(externalAccessAlertSchema),
});
export type ExternalAccessOverview = z.infer<typeof externalAccessOverviewSchema>;

export const externalAccessDeviceListSchema = z.object({
  accessScope: externalAccessAccessScope,
  accessMessage: z.string().nullable(),
  connection: externalAccessConnectionSchema,
  devices: z.array(externalAccessDeviceDetailSchema),
});
export type ExternalAccessDeviceList = z.infer<typeof externalAccessDeviceListSchema>;

// ---- 当前会话入口识别 -----------------------------------------------------------

export const externalAccessSessionSchema = z.object({
  viaTailscale: z.boolean(),
  login: z.string().nullable(),
  name: z.string().nullable(),
});
export type ExternalAccessSession = z.infer<typeof externalAccessSessionSchema>;

// ---- 端点注册表 ----------------------------------------------------------------

export const externalAccess = {
  settings: defineEndpoint({
    method: 'GET',
    path: '/external-access/settings',
    summary: '外部访问（Tailscale）连接设置（凭据只写不读，manage_integrations）',
    response: externalAccessSettingsSchema,
  }),
  updateSettings: defineEndpoint({
    method: 'PUT',
    path: '/external-access/settings',
    summary: '保存外部访问连接设置与只读凭据并记家庭活动（manage_integrations）',
    body: updateExternalAccessSettingsBody,
    response: externalAccessSettingsSchema,
  }),
  resetSettings: defineEndpoint({
    method: 'DELETE',
    path: '/external-access/settings',
    summary: '清除家庭覆盖，恢复服务器默认外部访问设置（manage_integrations）',
    response: externalAccessSettingsSchema,
  }),
  testSettings: defineEndpoint({
    method: 'POST',
    path: '/external-access/settings/test',
    summary: '测试 Tailscale 控制面连接并核验凭据为只读（manage_integrations）',
    body: testExternalAccessSettingsBody,
    response: externalAccessTestResultSchema,
  }),
  overview: defineEndpoint({
    method: 'GET',
    path: '/external-access/overview',
    summary: '外部访问概览：节点、设备摘要与到期/离线提醒，60 秒缓存（manage_integrations）',
    query: externalAccessOverviewQuery,
    response: externalAccessOverviewSchema,
  }),
  devices: defineEndpoint({
    method: 'GET',
    path: '/external-access/devices',
    summary: '外部访问设备明细列表，含 Tailscale 地址与标签（manage_integrations）',
    query: externalAccessOverviewQuery,
    response: externalAccessDeviceListSchema,
  }),
  device: defineEndpoint({
    method: 'GET',
    path: '/external-access/devices/:id',
    summary: '单台 Tailscale 设备明细（manage_integrations）',
    params: externalAccessDeviceParams,
    response: externalAccessDeviceDetailSchema,
  }),
  session: defineEndpoint({
    method: 'GET',
    path: '/external-access/session',
    summary: '当前请求是否经由 Tailscale Serve 外部通道接入（所有正式成员，非管理员隐藏 login）',
    response: externalAccessSessionSchema,
  }),
};
