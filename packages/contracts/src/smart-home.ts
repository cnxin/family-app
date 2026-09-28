import { z } from 'zod';
import { isoDateTime, memberRole, nullableDateTime, uuid } from './common';
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
  /** climate：设定温度、室内温度、可选模式、设定温度上下限 */
  targetTemperature: z.number().nullable(),
  currentTemperature: z.number().nullable(),
  hvacModes: z.array(z.string()).nullable(),
  minTemperature: z.number().nullable(),
  maxTemperature: z.number().nullable(),
  /**
   * 状态未必是真的：红外遥控类（米家空调伴侣）HA 只记得上次发了什么，空调本身开没开它不知道。
   * climate 一律当作这种（King 家的空调走红外），HA 自己报 assumed_state 的也算。页面上标「按上次操作显示」。
   */
  assumed: z.boolean(),
});
export type SmartHomeEntityState = z.infer<typeof smartHomeEntityStateSchema>;

export const SMART_HOME_ENTITY_CATEGORIES = ['config', 'diagnostic'] as const;
export const smartHomeEntityCategory = z.enum(SMART_HOME_ENTITY_CATEGORIES);

/**
 * 设备卡里默认展开的「主实体」候选：这几类本体（可控类），以及不是诊断 / 配置项的传感器。
 * 米家集成给内部属性的实体名加「* 」前缀（「* 循环任务、按键倒计时 …」），也不算。
 * 每台设备最多展开 SMART_HOME_PRIMARY_LIMIT 个，可控类优先、剩下位置给传感器，其余折进「更多」。
 */
export const SMART_HOME_PRIMARY_DOMAINS: readonly string[] = ['vacuum', 'cover', 'switch', 'climate', 'light'];
export const SMART_HOME_PRIMARY_LIMIT = 4;
export function isPrimarySmartHomeEntity(domain: string, category: string | null, name = '') {
  if (category || name.trimStart().startsWith('*')) return false;
  return SMART_HOME_PRIMARY_DOMAINS.includes(domain) || domain === 'sensor' || domain === 'binary_sensor';
}

/** 实体目录的一条：管理员挑白名单用。 */
export const smartHomeDirectoryEntrySchema = z.object({
  entityId: smartHomeEntityId,
  domain: smartHomeDomain,
  /** 去掉设备名前缀后的实体名（「厨下净水 RO到期预警」→「RO到期预警」）；本体实体就是设备名 */
  name: z.string(),
  /** HA 里的 friendly_name 原样 */
  fullName: z.string(),
  state: smartHomeEntityStateSchema,
  whitelisted: z.boolean(),
  /** HA 实体注册表的 entity_category：diagnostic / config 折进「更多」 */
  category: smartHomeEntityCategory.nullable(),
  primary: z.boolean(),
});
export type SmartHomeDirectoryEntry = z.infer<typeof smartHomeDirectoryEntrySchema>;

/** 目录里的一台设备（HA 设备注册表）。没有归属设备的实体归到 id 为 null 的一组。 */
export const smartHomeDirectoryDeviceSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  area: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  entities: z.array(smartHomeDirectoryEntrySchema),
});
export type SmartHomeDirectoryDevice = z.infer<typeof smartHomeDirectoryDeviceSchema>;

export const smartHomeDirectorySchema = z.object({
  connection: smartHomeConnectionSchema,
  /** 读到了设备注册表（WebSocket）。读不到时退回一组平铺，message 说原因 */
  grouped: z.boolean(),
  groupingMessage: z.string().nullable(),
  devices: z.array(smartHomeDirectoryDeviceSchema),
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
    /** E2：允许在小管家里控制（只有 SMART_HOME_ACTIONS 里的 domain 能开） */
    controllable: z.boolean().optional(),
    /** E2：谁能控。admin = 家庭管理员；member = 全家 */
    minRole: z.enum(['admin', 'member']).optional(),
  })
  .strict();
export type UpsertSmartHomeDeviceBody = z.infer<typeof upsertSmartHomeDeviceBody>;

// ---- E2：控制 -----------------------------------------------------------------------------------

/**
 * 能控的 domain 和动作。门锁、安防根本不进白名单；车库门 / 大门这类 cover（device_class garage、gate、door）
 * 只读，服务端按 HA 的 device_class 拒绝。
 */
export const SMART_HOME_ACTIONS = {
  vacuum: ['start', 'pause', 'return_to_base'],
  cover: ['open', 'stop', 'close'],
  switch: ['turn_on', 'turn_off'],
  scene: ['activate'],
  // 试探性纳入（2026-09-28 King）：开关、四种模式、设定温度 ±1。真机验证后再定去留
  climate: [
    'turn_on', 'turn_off', 'mode_cool', 'mode_heat', 'mode_fan_only', 'mode_auto', 'temperature_up', 'temperature_down',
  ],
} as const;
export type SmartHomeControllableDomain = keyof typeof SMART_HOME_ACTIONS;
export const SMART_HOME_CONTROLLABLE_DOMAINS = Object.keys(SMART_HOME_ACTIONS) as SmartHomeControllableDomain[];
export const SMART_HOME_READONLY_COVER_CLASSES = ['garage', 'gate', 'door'] as const;
export const smartHomeAction = z.enum([
  'start', 'pause', 'return_to_base', 'open', 'stop', 'close', 'turn_on', 'turn_off', 'activate',
  'mode_cool', 'mode_heat', 'mode_fan_only', 'mode_auto', 'temperature_up', 'temperature_down',
]);
export type SmartHomeAction = z.infer<typeof smartHomeAction>;

export function smartHomeActionsFor(domain: string): readonly SmartHomeAction[] {
  return (SMART_HOME_ACTIONS as Record<string, readonly SmartHomeAction[]>)[domain] ?? [];
}

/** 一次控制。requestId 是幂等键：同一次点击重发（网络抖动、连点）只执行一次，返回第一次的结果。 */
export const smartHomeCommandBody = z.object({ action: smartHomeAction, requestId: uuid }).strict();
export type SmartHomeCommandBody = z.infer<typeof smartHomeCommandBody>;

export const smartHomeCommandStatus = z.enum(['pending', 'succeeded', 'failed']);

/** 控制审计：谁、什么时候、按了什么、HA 回了什么（home-assistant-plan §6.3）。 */
export const smartHomeCommandSchema = z.object({
  id: uuid,
  entityId: smartHomeEntityId,
  action: smartHomeAction,
  status: smartHomeCommandStatus,
  message: z.string().nullable(),
  memberName: z.string(),
  createdAt: isoDateTime,
  finishedAt: nullableDateTime,
  /** 这次是按 requestId 取回的上一次结果，没有再发给 HA */
  replayed: z.boolean(),
});
export type SmartHomeCommand = z.infer<typeof smartHomeCommandSchema>;

/** 状态快照：白名单设备 + 各自当前状态（连不上 HA 时 state 为 null）+ 当前这个人能不能控。 */
export const smartHomeStatesSchema = z.object({
  connection: smartHomeConnectionSchema,
  devices: z.array(
    smartHomeDeviceSchema.extend({
      state: smartHomeEntityStateSchema.nullable(),
      canControl: z.boolean(),
    }),
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
    summary: 'HA 上可挑进白名单的实体，按设备分组（管理员；门锁、安防不列）',
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
  command: defineEndpoint({
    method: 'POST',
    path: '/smart-home/devices/:entityId/command',
    summary: '控制一台白名单设备（幂等键 + 审计 + 逐次校验权限）；HA 失败回 502，审计照记',
    params: smartHomeEntityParams,
    body: smartHomeCommandBody,
    response: smartHomeCommandSchema,
  }),
  commands: defineEndpoint({
    method: 'GET',
    path: '/smart-home/commands',
    summary: '最近 50 次控制（管理员）',
    response: z.array(smartHomeCommandSchema),
  }),
  states: defineEndpoint({
    method: 'GET',
    path: '/smart-home/states',
    summary: '白名单设备的当前状态（连不上 HA 时 state 为 null）',
    response: smartHomeStatesSchema,
  }),
};

// ---- E3：HA → 小管家（webhook + 首批联动） --------------------------------------------------------

/**
 * HA 的自动化打到 POST /smart-home/webhook/:householdId。请求头带时间戳和签名：
 *   X-Family-Timestamp: 秒级 Unix 时间（与服务端相差 5 分钟以内）
 *   X-Family-Signature: sha256(密钥 + sha256(密钥 + 时间戳 + "." + 原始请求体))，十六进制
 * 不是 HMAC：HA 的模板只有 sha256 这类普通哈希、没有 HMAC，也做不了字节异或，这是 HA 侧能算出来的
 * 带密钥签名里最稳的写法（两层包住密钥，防长度扩展）。设置页生成的 YAML 就按这个算。
 */
export const SMART_HOME_WEBHOOK_TOLERANCE_SECONDS = 300;
/** 轮换后旧密钥还能用多久（HA 那边改配置要时间）。 */
export const SMART_HOME_WEBHOOK_GRACE_HOURS = 24;
/** 同一个事件 id 在这段时间内重发只算一次。 */
export const SMART_HOME_WEBHOOK_DEDUP_MINUTES = 10;

export const SMART_HOME_WEBHOOK_EVENTS = ['ping', 'laundry_done', 'vacuum_done', 'filter_low'] as const;
export const smartHomeWebhookEvent = z.enum(SMART_HOME_WEBHOOK_EVENTS);
export type SmartHomeWebhookEvent = z.infer<typeof smartHomeWebhookEvent>;

export const smartHomeWebhookBody = z.object({
  /** HA 触发这次变化的 context id；重发时不变，用来去重 */
  eventId: z.string().trim().min(1).max(128),
  event: smartHomeWebhookEvent,
  entityId: z.string().max(255).optional(),
  /** laundry_done：哪台机器完成了 */
  appliance: z.enum(['washer', 'dryer']).optional(),
  /** filter_low：当前剩余（百分比） */
  value: z.number().optional(),
});
export type SmartHomeWebhookBody = z.infer<typeof smartHomeWebhookBody>;

export const smartHomeWebhookResultSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  /** 联动做了什么（给 HA 日志看）；关着的联动为 null */
  result: z.string().nullable(),
});

/** 三条联动：服务端写死，设置页只能开关、选触发实体。不做通用规则引擎。 */
export const smartHomeRulesSchema = z.object({
  laundry: z.object({
    enabled: z.boolean(),
    /** 洗衣机 / 烘干机「完成」看哪个实体（生成 HA 自动化用） */
    washerEntityId: smartHomeEntityId.nullable(),
    dryerEntityId: smartHomeEntityId.nullable(),
    /** 实体是文字状态时，变成哪个值算完成（比如「完成」）；二元传感器 on→off、数值降到 0 以下不用填 */
    doneValue: z.string().trim().max(40).nullable(),
  }),
  vacuum: z.object({ enabled: z.boolean(), entityId: smartHomeEntityId.nullable() }),
  filter: z.object({
    enabled: z.boolean(),
    entityId: smartHomeEntityId.nullable(),
    /** 剩余低于多少（%）算低 */
    threshold: z.number().int().min(1).max(99),
  }),
});
export type SmartHomeRules = z.infer<typeof smartHomeRulesSchema>;
export const DEFAULT_SMART_HOME_RULES: SmartHomeRules = {
  laundry: { enabled: true, washerEntityId: null, dryerEntityId: null, doneValue: null },
  vacuum: { enabled: true, entityId: null },
  filter: { enabled: true, entityId: null, threshold: 10 },
};

export const smartHomeWebhookSettingsSchema = z.object({
  configured: z.boolean(),
  secretHint: z.string().nullable(),
  rotatedAt: nullableDateTime,
  /** 旧密钥还能用到什么时候；没有旧密钥为 null */
  previousValidUntil: nullableDateTime,
  /** 相对 API 根的路径（前面拼上 HA 能访问到的小管家地址 + /api） */
  path: z.string(),
  rules: smartHomeRulesSchema,
});
export type SmartHomeWebhookSettings = z.infer<typeof smartHomeWebhookSettingsSchema>;

/** 轮换密钥的结果：明文只在这一次给出（生成 HA 配置用），之后只剩提示。 */
export const smartHomeWebhookSecretSchema = smartHomeWebhookSettingsSchema.extend({ secret: z.string() });
export type SmartHomeWebhookSecret = z.infer<typeof smartHomeWebhookSecretSchema>;

export const smartHomeWebhookEventRecordSchema = z.object({
  id: uuid,
  eventId: z.string(),
  event: z.string(),
  status: z.enum(['processed', 'ignored', 'failed']),
  result: z.string().nullable(),
  receivedAt: isoDateTime,
});
export type SmartHomeWebhookEventRecord = z.infer<typeof smartHomeWebhookEventRecordSchema>;

export const smartHomeHouseholdParams = z.object({ householdId: uuid });

export const smartHomeWebhook = {
  receive: defineEndpoint({
    method: 'POST',
    path: '/smart-home/webhook/:householdId',
    summary: 'HA → 小管家（公开；签名 + 时间戳；按事件 id 去重 10 分钟）',
    params: smartHomeHouseholdParams,
    body: smartHomeWebhookBody,
    response: smartHomeWebhookResultSchema,
  }),
  settings: defineEndpoint({
    method: 'GET',
    path: '/smart-home/webhook-settings',
    summary: 'webhook 与联动设置（管理员；密钥只回提示）',
    response: smartHomeWebhookSettingsSchema,
  }),
  rotateSecret: defineEndpoint({
    method: 'POST',
    path: '/smart-home/webhook-settings/secret',
    summary: '生成 / 轮换 webhook 密钥（明文只此一次；旧密钥宽限 24 小时）',
    response: smartHomeWebhookSecretSchema,
  }),
  updateRules: defineEndpoint({
    method: 'PUT',
    path: '/smart-home/webhook-settings/rules',
    summary: '联动开关与触发实体',
    body: smartHomeRulesSchema,
    response: smartHomeWebhookSettingsSchema,
  }),
  events: defineEndpoint({
    method: 'GET',
    path: '/smart-home/webhook-settings/events',
    summary: '最近收到的 HA 事件（管理员，排查用）',
    response: z.array(smartHomeWebhookEventRecordSchema),
  }),
};

// ---- E4：小管家 → HA（联动规则） ----------------------------------------------------------------

/**
 * 一条联动 = 触发 + 目标。触发按标题关键词匹配（周期家务、反复出现的日程都能一直生效）：
 * - task_done：标题含关键词的家务被打勾完成时；
 * - calendar_before：标题含关键词、有开始时间的日程，开始前 offsetMinutes 分钟。
 * 目标是白名单里开放了控制的设备 + 动作，走 E2 同一条控制链路（权限、审计、超时）。
 * 同一次发生（那一天的那件家务 / 那一场日程）只跑一次；失败不影响家务和日程本身，只在家庭动态里记一句。
 */
export const SMART_HOME_LINK_TRIGGERS = ['task_done', 'calendar_before'] as const;
export const smartHomeLinkTrigger = z.enum(SMART_HOME_LINK_TRIGGERS);
export type SmartHomeLinkTrigger = z.infer<typeof smartHomeLinkTrigger>;
export const SMART_HOME_LINK_MAX_OFFSET_MINUTES = 720;

export const smartHomeLinkRunSchema = z.object({
  status: z.enum(['pending', 'succeeded', 'failed']),
  message: z.string().nullable(),
  at: isoDateTime,
});

export const smartHomeLinkSchema = z.object({
  id: uuid,
  name: z.string(),
  trigger: smartHomeLinkTrigger,
  keyword: z.string(),
  offsetMinutes: z.number().int(),
  targetEntityId: smartHomeEntityId,
  action: smartHomeAction,
  enabled: z.boolean(),
  lastRun: smartHomeLinkRunSchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type SmartHomeLink = z.infer<typeof smartHomeLinkSchema>;

const linkFields = {
  name: z.string().trim().min(1, '起个名字').max(40, '名字不超过 40 字'),
  trigger: smartHomeLinkTrigger,
  keyword: z.string().trim().min(1, '填一个标题里会出现的词').max(40, '关键词不超过 40 字'),
  offsetMinutes: z.number().int().min(0).max(SMART_HOME_LINK_MAX_OFFSET_MINUTES),
  targetEntityId: smartHomeEntityId,
  action: smartHomeAction,
  enabled: z.boolean(),
};
export const createSmartHomeLinkBody = z
  .object({ ...linkFields, offsetMinutes: linkFields.offsetMinutes.optional(), enabled: linkFields.enabled.optional() })
  .strict();
export type CreateSmartHomeLinkBody = z.infer<typeof createSmartHomeLinkBody>;
export const updateSmartHomeLinkBody = z.object(linkFields).partial().strict();
export type UpdateSmartHomeLinkBody = z.infer<typeof updateSmartHomeLinkBody>;

export const smartHomeLinks = {
  list: defineEndpoint({
    method: 'GET',
    path: '/smart-home/links',
    summary: '小管家 → HA 的联动规则（管理员）',
    response: z.array(smartHomeLinkSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/smart-home/links',
    summary: '新建联动（目标必须在白名单里且开放了控制）',
    body: createSmartHomeLinkBody,
    response: smartHomeLinkSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/smart-home/links/:id',
    summary: '改联动 / 开关',
    params: z.object({ id: uuid }),
    body: updateSmartHomeLinkBody,
    response: smartHomeLinkSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/smart-home/links/:id',
    summary: '删联动',
    params: z.object({ id: uuid }),
    response: z.object({ id: uuid }),
  }),
};
