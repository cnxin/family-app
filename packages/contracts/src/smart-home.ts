import { z } from 'zod';
import { isoDateTime, memberRole, nullableDateTime } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/smart-home/（H3 E1：连接器 + 实体目录 + 白名单 + 只读状态）。
// 方案见 docs/home-assistant-plan.md，修正见 docs/pre-trial-plan.md H3。
//
// 小管家只认管理员显式加进白名单的实体；HA 上新增设备不会自动出现。
// 门锁、安防两个 domain 第一期连只读都不放（home-assistant-plan §8 拍板 2），目录里就过滤掉。

/** 第一期认的 HA domain。控制（E2）只在其中一部分上开放，其余一律只读显示。 */
export const SMART_HOME_DOMAINS = [
  'vacuum', 'cover', 'light', 'switch', 'input_boolean', 'fan', 'climate', 'humidifier',
  'water_heater', 'scene', 'script', 'sensor', 'binary_sensor', 'select', 'number',
] as const;
export const smartHomeDomain = z.enum(SMART_HOME_DOMAINS);
export type SmartHomeDomain = z.infer<typeof smartHomeDomain>;

/** 明确拒绝的 domain：目录不列、白名单不收。 */
export const SMART_HOME_BLOCKED_DOMAINS = ['lock', 'alarm_control_panel'] as const;

/** HA 的 entity_id：`<domain>.<object_id>`，只有小写字母、数字、下划线。 */
export const smartHomeEntityId = z
  .string()
  .max(255)
  .regex(/^[a-z_]+\.[a-z0-9_]+$/, '实体 ID 格式不对');
export const smartHomeEntityParams = z.object({ entityId: smartHomeEntityId });

export const smartHomeSettingsMode = z.enum(['household', 'server_default']);

/** 连接设置。令牌只写不读：只回「配没配」和一小段提示。 */
export const smartHomeConnectorSettingsSchema = z.object({
  mode: smartHomeSettingsMode,
  isEnabled: z.boolean(),
  baseUrl: z.string().nullable(),
  credentialConfigured: z.boolean(),
  credentialHint: z.string().nullable(),
  /** 启用 + 有地址 + 有令牌 */
  configured: z.boolean(),
  updatedAt: nullableDateTime,
});
export type SmartHomeConnectorSettings = z.infer<typeof smartHomeConnectorSettingsSchema>;

export const updateSmartHomeConnectorBody = z
  .object({
    isEnabled: z.boolean().optional(),
    baseUrl: z.string().max(2000).nullable().optional(),
    credential: z.string().max(2000).optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict();
export type UpdateSmartHomeConnectorBody = z.infer<typeof updateSmartHomeConnectorBody>;

/** 和 HA 的连接状况。所有调用 3 秒超时；连不上时 message 说清原因，别的页面不受影响。 */
export const smartHomeConnectionSchema = z.object({
  configured: z.boolean(),
  available: z.boolean(),
  checkedAt: isoDateTime,
  message: z.string(),
  version: z.string().nullable(),
});
export type SmartHomeConnection = z.infer<typeof smartHomeConnectionSchema>;

/** HA 上一个实体的当前状态，只挑页面用得上的几个属性，不透传整份 attributes。 */
export const smartHomeEntityStateSchema = z.object({
  state: z.string(),
  unit: z.string().nullable(),
  deviceClass: z.string().nullable(),
  /** cover 的开合百分比 */
  position: z.number().nullable(),
  /** vacuum 等自带的电量百分比 */
  battery: z.number().nullable(),
  lastChanged: nullableDateTime,
});
export type SmartHomeEntityState = z.infer<typeof smartHomeEntityStateSchema>;

/** 实体目录的一条：管理员挑白名单用。 */
export const smartHomeDirectoryEntrySchema = z.object({
  entityId: smartHomeEntityId,
  domain: smartHomeDomain,
  /** HA 里的 friendly_name */
  name: z.string(),
  state: smartHomeEntityStateSchema,
  whitelisted: z.boolean(),
});
export type SmartHomeDirectoryEntry = z.infer<typeof smartHomeDirectoryEntrySchema>;

export const smartHomeDirectorySchema = z.object({
  connection: smartHomeConnectionSchema,
  entities: z.array(smartHomeDirectoryEntrySchema),
});
export type SmartHomeDirectory = z.infer<typeof smartHomeDirectorySchema>;

/** 白名单里的一台设备。controllable / minRole / pinnedToToday 由 E2、E5 开放编辑。 */
export const smartHomeDeviceSchema = z.object({
  entityId: smartHomeEntityId,
  domain: smartHomeDomain,
  displayName: z.string(),
  area: z.string().nullable(),
  sortOrder: z.number().int(),
  controllable: z.boolean(),
  minRole: memberRole,
  pinnedToToday: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type SmartHomeDevice = z.infer<typeof smartHomeDeviceSchema>;

export const upsertSmartHomeDeviceBody = z
  .object({
    displayName: z.string().trim().min(1, '起个中文名').max(40, '名字不超过 40 字'),
    area: z.string().trim().max(20, '分组不超过 20 字').nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();
export type UpsertSmartHomeDeviceBody = z.infer<typeof upsertSmartHomeDeviceBody>;

/** 状态快照：白名单设备 + 各自当前状态（连不上 HA 时 state 为 null）。 */
export const smartHomeStatesSchema = z.object({
  connection: smartHomeConnectionSchema,
  devices: z.array(
    smartHomeDeviceSchema.extend({ state: smartHomeEntityStateSchema.nullable() }),
  ),
});
export type SmartHomeStates = z.infer<typeof smartHomeStatesSchema>;
export type SmartHomeDeviceWithState = SmartHomeStates['devices'][number];

export const smartHome = {
  connectorSettings: defineEndpoint({
    method: 'GET',
    path: '/smart-home/connector-settings',
    summary: 'Home Assistant 连接设置（管理员；令牌只回提示）',
    response: smartHomeConnectorSettingsSchema,
  }),
  updateConnectorSettings: defineEndpoint({
    method: 'PUT',
    path: '/smart-home/connector-settings',
    summary: '改连接地址 / 令牌（只写不读）/ 启用开关',
    body: updateSmartHomeConnectorBody,
    response: smartHomeConnectorSettingsSchema,
  }),
  resetConnectorSettings: defineEndpoint({
    method: 'DELETE',
    path: '/smart-home/connector-settings',
    summary: '删掉家庭设置，恢复服务器默认',
    response: smartHomeConnectorSettingsSchema,
  }),
  testConnectorSettings: defineEndpoint({
    method: 'POST',
    path: '/smart-home/connector-settings/test',
    summary: '连通性测试（GET /api/ + /api/config）',
    response: smartHomeConnectionSchema,
  }),
  entityDirectory: defineEndpoint({
    method: 'GET',
    path: '/smart-home/entity-directory',
    summary: 'HA 上可挑进白名单的实体（管理员；门锁、安防不列）',
    response: smartHomeDirectorySchema,
  }),
  devices: defineEndpoint({
    method: 'GET',
    path: '/smart-home/devices',
    summary: '白名单设备',
    response: z.array(smartHomeDeviceSchema),
  }),
  upsertDevice: defineEndpoint({
    method: 'PUT',
    path: '/smart-home/devices/:entityId',
    summary: '加进白名单 / 改中文名、分组、排序',
    params: smartHomeEntityParams,
    body: upsertSmartHomeDeviceBody,
    response: smartHomeDeviceSchema,
  }),
  removeDevice: defineEndpoint({
    method: 'DELETE',
    path: '/smart-home/devices/:entityId',
    summary: '移出白名单',
    params: smartHomeEntityParams,
    response: z.object({ entityId: smartHomeEntityId }),
  }),
  states: defineEndpoint({
    method: 'GET',
    path: '/smart-home/states',
    summary: '白名单设备的当前状态（连不上 HA 时 state 为 null）',
    response: smartHomeStatesSchema,
  }),
};
