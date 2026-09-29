import {
  SMART_HOME_CONTROLLABLE_DOMAINS,
  SMART_HOME_DOMAINS,
  SMART_HOME_FEATURED_LIMIT,
  isExcludedSmartHomeEntity,
  type SmartHomeIcon,
  type SmartHomeMergeReport,
} from '@family/contracts';
import { friendlyName, type HomeAssistantRawState } from './home-assistant.client';
import type { HomeAssistantDevice, HomeAssistantRegistries } from './home-assistant.ws';

// 智能家居页重做 R1 的纯函数（smart-home-redesign §4.1、§5.2）：默认主实体 / 主面板项 / 图标，
// 以及「按实体 → 按设备」的归并计划。服务、dry-run 命令、测试都用这一份，不连库也不连 HA。

export function domainOf(entityId: string) {
  return entityId.slice(0, entityId.indexOf('.'));
}

const isSensor = (domain: string) => domain === 'sensor' || domain === 'binary_sensor';
const isControllable = (domain: string) => (SMART_HOME_CONTROLLABLE_DOMAINS as readonly string[]).includes(domain);
const isSupported = (domain: string) => (SMART_HOME_DOMAINS as readonly string[]).includes(domain);

/**
 * 实体名去掉设备名前缀：HA 给「有实体名」的实体拼 friendly_name 是「设备名 实体名」，
 * 设备卡里已经有设备名了，只显示后半截。要求中间有分隔（空格、横线等），免得「客厅」吃掉「客厅窗帘」。
 */
export function stripDeviceName(fullName: string, deviceName: string | null) {
  if (!deviceName || fullName === deviceName || !fullName.startsWith(deviceName)) return fullName;
  const rest = fullName.slice(deviceName.length);
  if (!/^[\s\-_·:：]/.test(rest)) return fullName;
  return rest.replace(/^[\s\-_·:：]+/, '') || fullName;
}

export function haDeviceName(device: HomeAssistantDevice | undefined) {
  return device ? device.name_by_user || device.name || '未命名设备' : null;
}

/** 设备名 / 型号里认得出的家电。只用来定图标和「主实体优先选传感器」，不做任何厂商分支。 */
const APPLIANCES: { icon: SmartHomeIcon; pattern: RegExp }[] = [
  { icon: 'dryer', pattern: /烘干|干衣|dryer/i },
  { icon: 'washer', pattern: /洗衣|washer|washing/i },
  { icon: 'water_purifier', pattern: /净水|纯水|water.?purifier/i },
  { icon: 'fridge', pattern: /冰箱|fridge|refrigerator/i },
];

export function applianceIcon(...texts: (string | null | undefined)[]): SmartHomeIcon | null {
  const text = texts.filter(Boolean).join(' ');
  return APPLIANCES.find((one) => one.pattern.test(text))?.icon ?? null;
}

export function iconFor(primaryDomain: string, ...texts: (string | null | undefined)[]): SmartHomeIcon {
  switch (primaryDomain) {
    case 'vacuum':
      return 'vacuum';
    case 'cover':
      return 'curtain';
    case 'climate':
      return 'air_conditioner';
    case 'light':
      return 'light';
    case 'fan':
      return 'fan';
    case 'scene':
    case 'script':
      return 'scene';
    case 'switch':
    case 'input_boolean':
      return applianceIcon(...texts) ?? 'switch';
    case 'sensor':
    case 'binary_sensor':
      return applianceIcon(...texts) ?? 'sensor';
    default:
      return applianceIcon(...texts) ?? 'other';
  }
}

/** 设备下一个子实体的样子（挑默认值、目录、归并都用）。 */
export interface DeviceEntityInfo {
  entityId: string;
  domain: string;
  category: 'config' | 'diagnostic' | null;
  /** 去掉设备名前缀后的名字 */
  name: string;
  fullName: string;
  deviceClass: string | null;
}

/**
 * 一台 HA 设备下现在有哪些子实体：HA 里停用 / 隐藏的不算。supportedOnly 时只留小管家认的 domain
 * （挑主实体、主面板项用）；否则全要（knownEntityIds 用：以后新冒出来的才算「新实体」）。
 */
export function entitiesOfDevice(
  haDeviceId: string,
  registries: HomeAssistantRegistries,
  statesById: Map<string, HomeAssistantRawState>,
  { supportedOnly = true }: { supportedOnly?: boolean } = {},
): DeviceEntityInfo[] {
  const device = registries.devices.find((one) => one.id === haDeviceId);
  const deviceName = haDeviceName(device);
  return registries.entities
    .filter((entry) => entry.device_id === haDeviceId && !entry.disabled_by && !entry.hidden_by)
    .filter((entry) => !supportedOnly || isSupported(domainOf(entry.entity_id)))
    .map((entry) => {
      const raw = statesById.get(entry.entity_id);
      const fullName = raw ? friendlyName(raw) : entry.entity_id;
      const deviceClass = raw?.attributes?.device_class;
      return {
        entityId: entry.entity_id,
        domain: domainOf(entry.entity_id),
        category: entry.entity_category ?? null,
        name: stripDeviceName(fullName, deviceName),
        fullName,
        deviceClass: typeof deviceClass === 'string' ? deviceClass : null,
      };
    });
}

const PRIMARY_DOMAIN_ORDER = ['vacuum', 'cover', 'climate', 'switch'];

function plainEntity(entity: DeviceEntityInfo) {
  // 米家集成给内部属性加「* 」前缀；诊断 / 配置类不当主角
  return !entity.category && !entity.name.trimStart().startsWith('*') && !entity.fullName.includes(' * ');
}

function excluded(entity: DeviceEntityInfo) {
  return isExcludedSmartHomeEntity(entity.domain, entity.deviceClass, [entity.name, entity.fullName]);
}

/**
 * 「加进来」时的默认搭配（redesign §4.1）：
 * - 主实体 = 第一个可控实体（vacuum → cover → climate → switch，排除名单里的不算）；设备像家电（洗衣 / 烘干 / 净水 / 冰箱）时
 *   开关多半是附属功能（「冲洗」「复位」），先找传感器；都没有就第一个非诊断传感器，再没有就第一个认得的实体；
 * - 主面板项 = 除主实体外前 6 个非诊断 / 非配置传感器；
 * - 图标按主实体 domain，传感器 / 开关类再看设备名、型号。
 */
export function pickDefaults(entities: DeviceEntityInfo[], deviceName: string | null, model: string | null = null) {
  const candidates = entities.filter((entity) => plainEntity(entity) && !excluded(entity));
  const appliance = applianceIcon(deviceName, model);
  const controllable = PRIMARY_DOMAIN_ORDER.map((domain) => candidates.find((entity) => entity.domain === domain)).filter(
    (entity): entity is DeviceEntityInfo => Boolean(entity),
  );
  const firstSensor = candidates.find((entity) => isSensor(entity.domain));
  const strongControllable = controllable.find((entity) => entity.domain !== 'switch');
  const primary =
    strongControllable ??
    (appliance ? firstSensor ?? controllable[0] : controllable[0] ?? firstSensor) ??
    entities.find((entity) => !excluded(entity)) ??
    null;
  const featured = candidates
    .filter((entity) => entity !== primary && isSensor(entity.domain))
    .slice(0, SMART_HOME_FEATURED_LIMIT)
    .map((entity) => entity.entityId);
  return {
    primary,
    featured,
    icon: primary ? iconFor(primary.domain, deviceName, model) : 'other',
  };
}

// ---- 归并（§5.2）：只重排，不新增 ----------------------------------------------------------------

export interface LegacyRow {
  id: string;
  primaryEntityId: string;
  primaryDomain: string;
  displayName: string;
  area: string | null;
  controllable: boolean;
  minRole: string;
  pinnedToToday: boolean;
  sortOrder: number;
}

export interface ExistingDevice {
  id: string;
  haDeviceId: string | null;
  primaryEntityId: string;
  featuredEntityIds: string[];
}

export interface MergeGroup {
  haDeviceId: string;
  haDeviceName: string;
  /** 已经有一台（R1 之后新加的）同一 HA 设备：并进它，而不是再建 */
  intoExistingId: string | null;
  /** 保留哪一行（主实体那行）；并进已有设备时为 null，全部旧行删掉 */
  keepRowId: string | null;
  removeRowIds: string[];
  primaryEntityId: string;
  primaryDomain: string;
  featuredEntityIds: string[];
  droppedEntityIds: string[];
  displayName: string;
  area: string | null;
  controllable: boolean;
  minRole: string;
  pinnedToToday: boolean;
  sortOrder: number;
  icon: SmartHomeIcon;
  knownEntityIds: string[];
  sensorPrimaryWithControllable: boolean;
  controllableEntityIds: string[];
}

export interface MergePlan {
  groups: MergeGroup[];
  /** 注册表里查不到归属设备的旧行：保持单实体设备，只把 mergeState 改成 ok */
  singles: LegacyRow[];
}

function primaryRank(row: LegacyRow) {
  if (isControllable(row.primaryDomain) && row.controllable) return 0;
  if (isControllable(row.primaryDomain)) return 1;
  if (!isSensor(row.primaryDomain)) return 2;
  return 3;
}

/**
 * 旧行（每行一个实体）按 HA device_id 归并成设备。主实体只从旧行里挑（可控且开放了控制的 > 可控的 > 非传感器 > 传感器），
 * 其余旧行做主面板项（按排序取前 6，多的丢掉并写进报告）。「允许控制 / 谁能控」只取主实体那行，绝不放宽；
 * 在今天页显示：任一行勾了就勾；排序取最小。主实体是传感器、而设备有可控实体的，标出来让 King 手动决定（拍板 2）。
 */
export function planMerge(
  rows: LegacyRow[],
  registries: HomeAssistantRegistries,
  statesById: Map<string, HomeAssistantRawState>,
  existing: ExistingDevice[] = [],
): MergePlan {
  const deviceOfEntity = new Map(
    registries.entities.filter((entry) => entry.device_id).map((entry) => [entry.entity_id, entry.device_id as string]),
  );
  const byDevice = new Map<string, LegacyRow[]>();
  const singles: LegacyRow[] = [];
  for (const row of rows) {
    const haDeviceId = deviceOfEntity.get(row.primaryEntityId);
    const device = haDeviceId ? registries.devices.find((one) => one.id === haDeviceId) : undefined;
    if (!haDeviceId || !device || device.entry_type === 'service') {
      singles.push(row);
      continue;
    }
    byDevice.set(haDeviceId, [...(byDevice.get(haDeviceId) ?? []), row]);
  }

  const groups: MergeGroup[] = [];
  for (const [haDeviceId, members] of byDevice) {
    const device = registries.devices.find((one) => one.id === haDeviceId);
    const name = haDeviceName(device) ?? haDeviceId;
    const ordered = [...members].sort(
      (a, b) => primaryRank(a) - primaryRank(b) || a.sortOrder - b.sortOrder || a.primaryEntityId.localeCompare(b.primaryEntityId),
    );
    const already = existing.find((one) => one.haDeviceId === haDeviceId);
    const primaryRow = ordered[0];
    const rest = [...members]
      .filter((row) => row !== primaryRow)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.primaryEntityId.localeCompare(b.primaryEntityId));
    const baseFeatured = already ? already.featuredEntityIds : [];
    const incoming = (already ? members : rest).map((row) => row.primaryEntityId).filter((id) => !baseFeatured.includes(id));
    const room = Math.max(0, SMART_HOME_FEATURED_LIMIT - baseFeatured.length);
    const featured = [...baseFeatured, ...incoming.slice(0, room)];
    const dropped = incoming.slice(room);
    const all = entitiesOfDevice(haDeviceId, registries, statesById, { supportedOnly: false });
    const supported = all.filter((entity) => isSupported(entity.domain));
    const controllableEntityIds = supported
      .filter((entity) => isControllable(entity.domain) && plainEntity(entity) && !excluded(entity))
      .map((entity) => entity.entityId);
    const area = primaryRow.area ?? members.find((row) => row.area)?.area ?? null;
    groups.push({
      haDeviceId,
      haDeviceName: name,
      intoExistingId: already?.id ?? null,
      keepRowId: already ? null : primaryRow.id,
      removeRowIds: members.filter((row) => already || row !== primaryRow).map((row) => row.id),
      primaryEntityId: already?.primaryEntityId ?? primaryRow.primaryEntityId,
      primaryDomain: already ? domainOf(already.primaryEntityId) : primaryRow.primaryDomain,
      featuredEntityIds: featured,
      droppedEntityIds: dropped,
      displayName: primaryRow.displayName,
      area,
      controllable: primaryRow.controllable,
      minRole: primaryRow.minRole,
      pinnedToToday: members.some((row) => row.pinnedToToday),
      sortOrder: Math.min(...members.map((row) => row.sortOrder)),
      icon: iconFor(primaryRow.primaryDomain, name, device?.model ?? null),
      knownEntityIds: all.map((entity) => entity.entityId),
      sensorPrimaryWithControllable:
        !already && isSensor(primaryRow.primaryDomain) && controllableEntityIds.length > 0,
      controllableEntityIds,
    });
  }
  return { groups, singles };
}

/** 把计划写成给人看的报告（dry-run 和真归并同一份格式）。 */
export function mergeReport(
  plan: MergePlan,
  rows: LegacyRow[],
  { dryRun, mergedAt, references = [], deviceIds = new Map<string, string>() }: {
    dryRun: boolean;
    mergedAt: Date;
    references?: string[];
    /** haDeviceId → 归并后设备 id（真归并时才有） */
    deviceIds?: Map<string, string>;
  },
): SmartHomeMergeReport {
  const reportRows: SmartHomeMergeReport['rows'] = [];
  for (const row of rows) {
    const group = plan.groups.find((one) => one.removeRowIds.includes(row.id) || one.keepRowId === row.id);
    if (!group) {
      reportRows.push({ entityId: row.primaryEntityId, displayName: row.displayName, haDeviceName: null, role: 'single' });
      continue;
    }
    const role =
      group.primaryEntityId === row.primaryEntityId && !group.intoExistingId
        ? 'primary'
        : group.droppedEntityIds.includes(row.primaryEntityId)
          ? 'dropped'
          : 'featured';
    reportRows.push({ entityId: row.primaryEntityId, displayName: row.displayName, haDeviceName: group.haDeviceName, role });
  }
  return {
    mergedAt: mergedAt.toISOString(),
    dryRun,
    rows: reportRows,
    devices: [
      ...plan.groups.map((group) => ({
        deviceId: deviceIds.get(group.haDeviceId) ?? group.intoExistingId ?? group.keepRowId,
        haDeviceId: group.haDeviceId,
        displayName: group.displayName,
        primaryEntityId: group.primaryEntityId,
        featuredEntityIds: group.featuredEntityIds,
        controllable: group.controllable,
        sensorPrimaryWithControllable: group.sensorPrimaryWithControllable,
        controllableEntityIds: group.controllableEntityIds,
      })),
      ...plan.singles.map((row) => ({
        deviceId: row.id,
        haDeviceId: null,
        displayName: row.displayName,
        primaryEntityId: row.primaryEntityId,
        featuredEntityIds: [],
        controllable: row.controllable,
        sensorPrimaryWithControllable: false,
        controllableEntityIds: [],
      })),
    ],
    references,
  };
}

/** 报告的纯文本版（dry-run 命令打印、贴进汇报）。 */
export function formatMergeReport(report: SmartHomeMergeReport) {
  const roleText = { primary: '主实体', featured: '主面板项', dropped: '挤出主面板（仍在详情里）', single: '保持单实体' } as const;
  const lines = [
    `${report.dryRun ? '【dry-run，没有写库】' : '【已归并】'} ${report.mergedAt}`,
    '',
    '原来的每一行：',
    ...report.rows.map(
      (row) => `  - ${row.displayName}（${row.entityId}）→ ${row.haDeviceName ?? '（HA 里查不到归属设备）'}：${roleText[row.role]}`,
    ),
    '',
    '归并后的设备：',
    ...report.devices.map((device) => {
      const flag = device.sensorPrimaryWithControllable
        ? `\n      ⚠️ 主实体是传感器，但这台设备有可控实体：${device.controllableEntityIds.join('、')}——要不要换主实体，King 定`
        : '';
      return `  - ${device.displayName}：主实体 ${device.primaryEntityId}；主面板项 ${
        device.featuredEntityIds.length ? device.featuredEntityIds.join('、') : '无'
      }；${device.controllable ? '已开放控制' : '未开放控制'}${flag}`;
    }),
  ];
  if (report.references.length) lines.push('', '引用改写：', ...report.references.map((line) => `  - ${line}`));
  return lines.join('\n');
}
