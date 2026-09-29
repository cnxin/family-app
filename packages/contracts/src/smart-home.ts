import { z } from 'zod';
import { isoDateTime, memberRole, nullableDateTime, uuid } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/smart-home/（H3 E1：连接器 + 实体目录 + 白名单 + 只读状态）。
// 方案见 docs/home-assistant-plan.md，修正见 docs/pre-trial-plan.md H3；
// 智能家居页重做（R1 起白名单按「设备」）见 docs/ui-prototypes/smart-home-redesign.md。
//
// 小管家只认管理员显式加进白名单的设备；HA 上新增设备不会自动出现。
// 门锁、安防两个 domain 第一期连只读都不放（home-assistant-plan §8 拍板 2），目录里就过滤掉。

/** 第一期认的 HA domain。控制（E2）只在其中一部分上开放，其余一律只读显示。 */
export const SMART_HOME_DOMAINS = [
  'vacuum', 'cover', 'light', 'switch', 'input_boolean', 'fan', 'climate', 'humidifier',
  'water_heater', 'scene', 'script', 'sensor', 'binary_sensor', 'select', 'number',
  // R1b：详情面板里的按钮（例程、「响一下」）和只读文字
  'button', 'text',
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
/** 白名单设备的 id（smart_home_devices.id）。R1 起所有引用都用它，不再用实体 ID。 */
export const smartHomeDeviceParams = z.object({ id: uuid });

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
  /**
   * HA 的 last_updated：只改属性（窗帘位置、空调风速）时 last_changed 不动、它会动。
   * 详情面板靠它判断「发出去的命令回推到了」。
   */
  lastUpdated: nullableDateTime,
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
  /** R1b 详情面板：扫地机当前吸力、空调当前风速 / 摆风、室内湿度（没有为 null） */
  fanSpeed: z.string().nullable(),
  fanMode: z.string().nullable(),
  swingMode: z.string().nullable(),
  humidity: z.number().nullable(),
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

/**
 * 排除名单（redesign §9.4，King 2026-09-29 拍板 8）：名字里带这些词的可控实体（button、switch 等）一律不渲染成控件、
 * 命令接口也拒，只在「设备信息」里写「此操作请在厂商 App 完成」。button 的 device_class 为 restart / update 同样排除。
 * 真机上 Roborock 的「重置主刷耗材」没有 device_class、用的是「重置」；海尔净水器的「初滤复位」是 switch 不是 button。
 */
export const SMART_HOME_EXCLUDED_KEYWORDS = [
  '复位', '重置', '重启', '恢复出厂', '解绑', 'reset', 'reboot', 'restart', 'factory', 'unbind', 'unpair',
] as const;
export const SMART_HOME_EXCLUDED_BUTTON_CLASSES = ['restart', 'update'] as const;

export function isExcludedSmartHomeEntity(domain: string, deviceClass: string | null, names: readonly string[]) {
  if ((SMART_HOME_BLOCKED_DOMAINS as readonly string[]).includes(domain)) return true;
  // 只看能按的东西：传感器叫「上次复位时间」之类没关系
  if (domain === 'sensor' || domain === 'binary_sensor') return false;
  if (domain === 'button' && (SMART_HOME_EXCLUDED_BUTTON_CLASSES as readonly string[]).includes(deviceClass ?? '')) return true;
  const text = names.join(' ').toLowerCase();
  return SMART_HOME_EXCLUDED_KEYWORDS.some((keyword) => text.includes(keyword));
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
  /** 目录里默认展开（设备卡上直接摆出来），其余折进「更多」 */
  primary: z.boolean(),
  /** 整台设备「加进来」时这个实体默认当什么：主实体 / 主面板项 / 都不是 */
  defaultRole: z.enum(['primary', 'featured']).nullable(),
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
  /** 这台已经在白名单里：对应的 smart_home_devices.id */
  whitelistedDeviceId: uuid.nullable(),
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

/** 卡片和详情用的图标类型。布局按它定，不按厂商定。 */
export const SMART_HOME_ICONS = [
  'vacuum', 'curtain', 'air_conditioner', 'washer', 'dryer', 'water_purifier', 'fridge',
  'switch', 'light', 'fan', 'sensor', 'scene', 'other',
] as const;
export const smartHomeIcon = z.enum(SMART_HOME_ICONS);
export type SmartHomeIcon = z.infer<typeof smartHomeIcon>;

/** 主面板项上限（redesign §9.3，King 2026-09-29 拍板 9）。 */
export const SMART_HOME_FEATURED_LIMIT = 6;
/** 今天页最多几张设备卡（拍板 5）；设置页勾超了给提示。 */
export const SMART_HOME_TODAY_LIMIT = 4;

/**
 * 白名单里的一台设备（redesign §4.1）。一台 = 一个主实体（卡片的状态句和唯一主按钮）+ 至多 6 个主面板项。
 * haDeviceId 为 null 的是「单实体设备」：场景、脚本、没有归属设备的 helper。
 * legacy：R1 迁移前按实体登记的旧行，等连上 HA 后按设备归并（§5）；归并前照常显示和控制。
 */
export const smartHomeDeviceSchema = z.object({
  id: uuid,
  haDeviceId: z.string().nullable(),
  displayName: z.string(),
  area: z.string().nullable(),
  sortOrder: z.number().int(),
  icon: smartHomeIcon,
  primaryEntityId: smartHomeEntityId,
  primaryDomain: smartHomeDomain,
  featuredEntityIds: z.array(smartHomeEntityId),
  /** 管理员从详情面板里藏掉的子实体：既不显示也不放行命令 */
  hiddenEntityIds: z.array(smartHomeEntityId),
  controllable: z.boolean(),
  minRole: memberRole,
  pinnedToToday: z.boolean(),
  legacy: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type SmartHomeDevice = z.infer<typeof smartHomeDeviceSchema>;

/** 目录里「加进来」：整台 HA 设备，或一个没有归属设备的实体（场景、脚本…）。 */
export const addSmartHomeDeviceBody = z
  .object({
    haDeviceId: z.string().trim().min(1).max(64).optional(),
    entityId: smartHomeEntityId.optional(),
  })
  .strict()
  .refine((body) => Boolean(body.haDeviceId) !== Boolean(body.entityId), {
    message: '要么给 HA 设备，要么给一个没有归属设备的实体',
  });
export type AddSmartHomeDeviceBody = z.infer<typeof addSmartHomeDeviceBody>;

export const updateSmartHomeDeviceBody = z
  .object({
    displayName: z.string().trim().min(1, '起个中文名').max(40, '名字不超过 40 字'),
    area: z.string().trim().max(20, '房间不超过 20 字').nullable(),
    sortOrder: z.number().int().min(0).max(9999),
    icon: smartHomeIcon,
    primaryEntityId: smartHomeEntityId,
    featuredEntityIds: z.array(smartHomeEntityId).max(SMART_HOME_FEATURED_LIMIT, `主面板项最多 ${SMART_HOME_FEATURED_LIMIT} 个`),
    hiddenEntityIds: z.array(smartHomeEntityId).max(200),
    /** 允许在小管家里控制（主实体得是能控的类型） */
    controllable: z.boolean(),
    /** 谁能控。admin = 家庭管理员；member = 全家 */
    minRole: z.enum(['admin', 'member']),
    pinnedToToday: z.boolean(),
    /** 「N 个新实体待确认」：管理员点了，这些 HA 新冒出来的子实体才放出来（拍板 7） */
    acceptEntityIds: z.array(smartHomeEntityId).max(200),
  })
  .partial()
  .strict();
export type UpdateSmartHomeDeviceBody = z.infer<typeof updateSmartHomeDeviceBody>;

/** 指向「某台白名单设备的某个子实体」：E3 触发、E4 目标、E5 留意规则都用它（redesign §4.2）。 */
export const smartHomeEntityRef = z.object({
  deviceId: uuid,
  entityId: smartHomeEntityId,
});
export type SmartHomeEntityRef = z.infer<typeof smartHomeEntityRef>;

/** 归并报告的一行（redesign §5.3）：原来按实体登记的一行归到了哪台设备、当什么。 */
export const smartHomeMergeRowSchema = z.object({
  entityId: smartHomeEntityId,
  displayName: z.string(),
  /** 归到的 HA 设备名；null = HA 里查不到归属设备，保持单实体 */
  haDeviceName: z.string().nullable(),
  role: z.enum(['primary', 'featured', 'dropped', 'single']),
});
export const smartHomeMergeDeviceSchema = z.object({
  deviceId: uuid.nullable(),
  haDeviceId: z.string().nullable(),
  displayName: z.string(),
  primaryEntityId: smartHomeEntityId,
  featuredEntityIds: z.array(smartHomeEntityId),
  controllable: z.boolean(),
  /** 主实体是传感器、但这台设备有可控实体：King 要手动决定换不换（拍板 2） */
  sensorPrimaryWithControllable: z.boolean(),
  controllableEntityIds: z.array(smartHomeEntityId),
});
export const smartHomeMergeReportSchema = z.object({
  mergedAt: isoDateTime,
  dryRun: z.boolean(),
  rows: z.array(smartHomeMergeRowSchema),
  devices: z.array(smartHomeMergeDeviceSchema),
  /** 联动、规则、审计的引用改到了哪里 */
  references: z.array(z.string()),
});
export type SmartHomeMergeReport = z.infer<typeof smartHomeMergeReportSchema>;

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
  // 场景行里的脚本（King 2026-09-29 拍板 4）：script.turn_on，只限白名单里的脚本
  script: ['activate'],
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
  // R1b 详情面板（redesign §9.5）：带值的动作，值按 HA 当前属性校验
  'set_position', 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode', 'set_fan_speed',
  'clean_area', 'select_option', 'set_value', 'press',
]);
export type SmartHomeAction = z.infer<typeof smartHomeAction>;

export function smartHomeActionsFor(domain: string): readonly SmartHomeAction[] {
  return (SMART_HOME_ACTIONS as Record<string, readonly SmartHomeAction[]>)[domain] ?? [];
}

/** 一次控制。requestId 是幂等键：同一次点击重发（网络抖动、连点）只执行一次，返回第一次的结果。 */
export const smartHomeCommandValue = z.union([
  z.string().trim().min(1).max(100),
  z.number().finite(),
  z.array(z.string().trim().min(1).max(64)).min(1).max(30),
]);
export const smartHomeCommandBody = z
  .object({
    action: smartHomeAction,
    requestId: uuid,
    /** 这台设备的哪个子实体；缺省 = 主实体（R1b） */
    entityId: smartHomeEntityId.optional(),
    /** 带值的动作要的值：位置、温度、档位、选项、区域 id 列表… */
    value: smartHomeCommandValue.optional(),
  })
  .strict();
export type SmartHomeCommandBody = z.infer<typeof smartHomeCommandBody>;

export const smartHomeCommandStatus = z.enum(['pending', 'succeeded', 'failed']);

/** 控制审计：谁、什么时候、按了什么、HA 回了什么（home-assistant-plan §6.3）。 */
export const smartHomeCommandSchema = z.object({
  id: uuid,
  /** 这条操作对应的白名单设备；设备后来被移出、或 R1 之前对不上的历史记录为 null */
  deviceId: uuid.nullable(),
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

/** 设备的一个子实体此刻的样子（卡片补半句、详情主面板项用）。 */
export const smartHomeEntitySnapshotSchema = z.object({
  entityId: smartHomeEntityId,
  domain: z.string(),
  /** 去掉设备名前缀后的名字（「厨下净水 RO剩余百分比」→「RO剩余百分比」） */
  name: z.string(),
  /** HA 上没有这个实体时是 unavailable；整个 HA 连不上且没有上次状态时为 null */
  state: smartHomeEntityStateSchema.nullable(),
});
export type SmartHomeEntitySnapshot = z.infer<typeof smartHomeEntitySnapshotSchema>;

/**
 * 状态快照：白名单设备 + 主实体和主面板项的状态 + 当前这个人能不能控。
 * HA 连不上时给**上次**读到的状态（stale = true，asOf 是那一次的时间），页面灰显；API 重启后还没读到过则为 null。
 */
export const smartHomeStatesSchema = z.object({
  connection: smartHomeConnectionSchema,
  stale: z.boolean(),
  asOf: nullableDateTime,
  devices: z.array(
    smartHomeDeviceSchema.extend({
      primary: smartHomeEntityStateSchema.nullable(),
      featured: z.array(smartHomeEntitySnapshotSchema),
      /** 主实体不是 unavailable（HA 连不上时按上次状态算） */
      online: z.boolean(),
      canControl: z.boolean(),
    }),
  ),
});
export type SmartHomeStates = z.infer<typeof smartHomeStatesSchema>;
export type SmartHomeDeviceWithState = SmartHomeStates['devices'][number];

// ---- R1b：详情面板（redesign §9） ---------------------------------------------------------------

/** 一个可选值：HA 里的原始值 + 给人看的中文（HA 的翻译，取不到就用内置词表，再不行原样）。 */
export const smartHomeChoiceSchema = z.object({ value: z.string(), label: z.string() });
export type SmartHomeChoice = z.infer<typeof smartHomeChoiceSchema>;

/**
 * 这个实体在面板上怎么渲染、能发哪些动作（服务端 describeEntity 算；命令接口放行前用同一个函数）。
 * null = 只读。通用控件不含任何厂商逻辑：数据只来自 HA 的通用属性。
 */
export const smartHomeControlSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('toggle') }),
  z.object({ kind: z.literal('button') }),
  z.object({ kind: z.literal('scene') }),
  z.object({ kind: z.literal('select'), options: z.array(smartHomeChoiceSchema) }),
  z.object({
    kind: z.literal('number'),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    unit: z.string().nullable(),
    /** HA 的 mode：slider → 滑块；box → 步进；auto 按步数（≤ 100 步用滑块） */
    display: z.enum(['slider', 'stepper']),
  }),
  z.object({
    kind: z.literal('cover'),
    actions: z.array(z.enum(['open', 'stop', 'close'])),
    /** 有 SET_POSITION 且有 current_position：出位置滑块 */
    position: z.boolean(),
  }),
  z.object({
    kind: z.literal('vacuum'),
    actions: z.array(z.enum(['start', 'pause', 'return_to_base'])),
    /** vacuum 本体的 fan_speed_list（HA 通用属性）；没有为 null */
    fanSpeeds: z.array(smartHomeChoiceSchema).nullable(),
    /** 支持 CLEAN_AREA、且 HA 里已把分区对应到区域：这些区域（HA 2026.3 起的 vacuum.clean_area）；否则 null */
    areas: z.array(z.object({ id: z.string(), name: z.string() })).nullable(),
  }),
  z.object({
    kind: z.literal('climate'),
    hvacModes: z.array(smartHomeChoiceSchema),
    min: z.number(),
    max: z.number(),
    /** target_temp_step；HA 没给按 0.5（与 HA 前端一致） */
    step: z.number(),
    fanModes: z.array(smartHomeChoiceSchema).nullable(),
    swingModes: z.array(smartHomeChoiceSchema).nullable(),
  }),
]);
export type SmartHomeControl = z.infer<typeof smartHomeControlSchema>;

export const smartHomePanelEntitySchema = z.object({
  entityId: smartHomeEntityId,
  domain: z.string(),
  name: z.string(),
  category: smartHomeEntityCategory.nullable(),
  state: smartHomeEntityStateSchema.nullable(),
  control: smartHomeControlSchema.nullable(),
});
export type SmartHomePanelEntity = z.infer<typeof smartHomePanelEntitySchema>;

/**
 * 一台设备的完整控制面板（redesign §9.1）。主实体 + 主面板项 + 其余子实体按规则归位：
 * more = 更多设置（能控的，config 类也在这）；info = 设备信息（diagnostic 与其余只读）；
 * excluded = 排除名单里的操作（「此操作请在厂商 App 完成」）；pending = HA 新冒出来、还没确认的子实体（只给管理员）。
 * 没权限的人拿到的 control 一律为 null，more 为空。
 */
export const smartHomePanelSchema = z.object({
  device: smartHomeDeviceSchema,
  connection: smartHomeConnectionSchema,
  stale: z.boolean(),
  asOf: nullableDateTime,
  online: z.boolean(),
  /** 这个人此刻能不能控这台（设备开放了控制 + 角色够） */
  canControl: z.boolean(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  primary: smartHomePanelEntitySchema,
  featured: z.array(smartHomePanelEntitySchema),
  more: z.array(smartHomePanelEntitySchema),
  info: z.array(smartHomePanelEntitySchema),
  excluded: z.array(z.object({ entityId: smartHomeEntityId, name: z.string() })),
  pending: z.array(z.object({ entityId: smartHomeEntityId, name: z.string(), domain: z.string() })),
  /** 管理员挑主实体 / 主面板项 / 藏掉用的全部子实体（成员为空） */
  catalog: z.array(
    z.object({
      entityId: smartHomeEntityId,
      name: z.string(),
      domain: z.string(),
      category: smartHomeEntityCategory.nullable(),
      hidden: z.boolean(),
    }),
  ),
  /** 这台设备最近 3 条操作（全家可见，拍板 3） */
  recent: z.array(smartHomeCommandSchema),
});
export type SmartHomePanel = z.infer<typeof smartHomePanelSchema>;

export const smartHomeHistoryQuery = z.object({ entityId: smartHomeEntityId });
export type SmartHomeHistoryQuery = z.infer<typeof smartHomeHistoryQuery>;
/** 最近 24 小时的数值（服务端降采样到 ≤ 48 点）；不是数值、或 HA 历史取不到时 points 为空。 */
export const smartHomeHistorySchema = z.object({
  entityId: smartHomeEntityId,
  unit: z.string().nullable(),
  points: z.array(z.object({ at: isoDateTime, value: z.number() })),
});
export type SmartHomeHistory = z.infer<typeof smartHomeHistorySchema>;

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
    summary: '白名单设备（按设备，一台一行）',
    response: z.array(smartHomeDeviceSchema),
  }),
  addDevice: defineEndpoint({
    method: 'POST',
    path: '/smart-home/devices',
    summary: '把一台 HA 设备（或一个没有归属设备的实体）加进白名单；主实体、主面板项、图标由服务端按默认规则算',
    body: addSmartHomeDeviceBody,
    response: smartHomeDeviceSchema,
  }),
  updateDevice: defineEndpoint({
    method: 'PATCH',
    path: '/smart-home/devices/:id',
    summary: '改名字、房间、图标、排序、主实体、主面板项、藏掉的子实体、控制、今天页',
    params: smartHomeDeviceParams,
    body: updateSmartHomeDeviceBody,
    response: smartHomeDeviceSchema,
  }),
  removeDevice: defineEndpoint({
    method: 'DELETE',
    path: '/smart-home/devices/:id',
    summary: '移出白名单（有联动或规则引用时 409，列出是哪几条）',
    params: smartHomeDeviceParams,
    response: z.object({ id: uuid }),
  }),
  command: defineEndpoint({
    method: 'POST',
    path: '/smart-home/devices/:id/command',
    summary: '控制一台白名单设备（缺省主实体，也可以是它的子实体；幂等键 + 审计 + 逐次校验权限 + 按 HA 属性校验值）；HA 失败回 502',
    params: smartHomeDeviceParams,
    body: smartHomeCommandBody,
    response: smartHomeCommandSchema,
  }),
  panel: defineEndpoint({
    method: 'GET',
    path: '/smart-home/devices/:id/panel',
    summary: '一台设备的完整控制面板：主实体、主面板项、更多设置、设备信息、排除项、待确认的新实体、最近 3 条操作',
    params: smartHomeDeviceParams,
    response: smartHomePanelSchema,
  }),
  history: defineEndpoint({
    method: 'GET',
    path: '/smart-home/devices/:id/history',
    summary: '这台设备某个数值子实体最近 24 小时（≤ 48 点；取不到为空）',
    params: smartHomeDeviceParams,
    query: smartHomeHistoryQuery,
    response: smartHomeHistorySchema,
  }),
  mergeReport: defineEndpoint({
    method: 'GET',
    path: '/smart-home/devices/merge-report',
    summary: '最近一次「按实体 → 按设备」归并的结果（管理员；没归并过为 null）',
    response: smartHomeMergeReportSchema.nullable(),
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
    /** 洗衣机 / 烘干机「完成」看哪台设备的哪个子实体（生成 HA 自动化用） */
    washer: smartHomeEntityRef.nullable(),
    dryer: smartHomeEntityRef.nullable(),
    /** 实体是文字状态时，变成哪个值算完成（比如「完成」）；二元传感器 on→off、数值降到 0 以下不用填 */
    doneValue: z.string().trim().max(40).nullable(),
  }),
  vacuum: z.object({ enabled: z.boolean(), trigger: smartHomeEntityRef.nullable() }),
  filter: z.object({
    enabled: z.boolean(),
    trigger: smartHomeEntityRef.nullable(),
    /** 剩余低于多少（%）算低 */
    threshold: z.number().int().min(1).max(99),
  }),
});
export type SmartHomeRules = z.infer<typeof smartHomeRulesSchema>;
export const DEFAULT_SMART_HOME_RULES: SmartHomeRules = {
  laundry: { enabled: true, washer: null, dryer: null, doneValue: null },
  vacuum: { enabled: true, trigger: null },
  filter: { enabled: true, trigger: null, threshold: 10 },
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
 * 目标是白名单里开放了控制的设备（的主实体）+ 动作，走 E2 同一条控制链路（权限、审计、超时）。
 * R1 起按设备 id 引用；targetEntityId 是那台设备当时的主实体，只做显示。
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
  /** 目标设备；R1 之前建的、目标设备后来被移出的为 null（这种联动已停用） */
  targetDeviceId: uuid.nullable(),
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
  targetDeviceId: uuid,
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
    summary: '新建联动（目标设备必须在白名单里且开放了控制）',
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
