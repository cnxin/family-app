import type { SmartHomeAction, SmartHomeDomain, SmartHomeEntityState, SmartHomeIcon } from '@family/contracts';
import { deviceStatusLine } from '@family/shared';

// 智能家居页面上的文案与小工具。一个实体 / 一台设备的「一句状态」（smartHomeStateLine / deviceStatusLine）在
// @family/shared（服务端小管家 get_device_status 也用它，第四批收尾起只留这一份），这里是只有页面用的。

/** 页面上一台设备的形状（主实体与主面板项的状态）。 */
export interface DeviceLike {
  icon: SmartHomeIcon;
  primaryDomain: string;
  primary: SmartHomeEntityState | null;
  featured: { entityId: string; domain: string; name: string; state: SmartHomeEntityState | null }[];
}

/** 百分比类传感器的短名：「初滤剩余百分比」→「初滤剩余」。 */
export function percentLabel(name: string) {
  return name.replace(/百分比$/, '').trim() || name;
}

export interface PrimaryButton {
  action: 'start' | 'pause' | 'open' | 'close' | 'stop' | 'turn_on' | 'turn_off';
  /** 按钮上写的是「按下会发生什么」，不是当前状态（redesign §2.1） */
  label: string;
}

/**
 * 卡片上唯一的主按钮（redesign §3.3）：扫地机 暂停 / 继续 / 开始，窗帘 打开 / 关上 / 停，开关与空调 打开 / 关掉；
 * 洗衣机、净水器、传感器没有。出错、离线、读不到状态时也没有。
 */
export function primaryButton(primaryDomain: string, state: SmartHomeEntityState | null): PrimaryButton | null {
  const value = state?.state;
  if (!value || value === 'unavailable' || value === 'unknown') return null;
  switch (primaryDomain) {
    case 'vacuum':
      if (value === 'cleaning' || value === 'returning') return { action: 'pause', label: '暂停' };
      if (value === 'error') return null;
      return { action: 'start', label: value === 'paused' ? '继续' : '开始' };
    case 'cover':
      if (value === 'opening' || value === 'closing') return { action: 'stop', label: '停' };
      return value === 'closed' ? { action: 'open', label: '打开' } : { action: 'close', label: '关上' };
    case 'switch':
    case 'climate':
      return value === 'off' ? { action: 'turn_on', label: '打开' } : { action: 'turn_off', label: '关掉' };
    default:
      return null;
  }
}

type StatesLike = {
  connection: { configured: boolean; available: boolean };
  devices: (DeviceLike & { pinnedToToday: boolean; online: boolean })[];
};

const isSceneDomain = (domain: string) => domain === 'scene' || domain === 'script';

/**
 * 今天页「家里的设备」（redesign §2.5）：勾了「在今天页显示」的设备，按服务端的排序取前 limit 台；
 * 场景、脚本不算设备（它们在智能家居页的场景一排）。total 是智能家居页一共有几台，给「全部 N 台」用。
 */
export function todayDevices<T extends StatesLike['devices'][number]>(devices: T[], limit: number) {
  const all = devices.filter((device) => !isSceneDomain(device.primaryDomain));
  return { shown: all.filter((device) => device.pinnedToToday).slice(0, limit), total: all.length };
}

/**
 * 家里页智能家居图块的状态行：连着时「N 台设备 · M 台在运行」（运行 = 卡片会着色的那些），
 * 断开时「连不上 Home Assistant」；还没连、白名单是空的就不写（图块本身只有名字）。
 */
export function smartHomeTileLine(states: StatesLike | undefined): string | undefined {
  if (!states?.connection.configured) return undefined;
  const devices = states.devices.filter((device) => !isSceneDomain(device.primaryDomain));
  if (!devices.length) return undefined;
  if (!states.connection.available) return '连不上 Home Assistant';
  const running = devices.filter((device) => device.online && deviceStatusLine(device).tone === 'on').length;
  const warn = devices.filter((device) => device.online && deviceStatusLine(device).tone === 'warn').length;
  const offline = devices.filter((device) => !device.online).length;
  const tail = [
    running ? `${running} 台在运行` : '',
    warn ? `${warn} 台要留意` : '',
    offline ? `${offline} 台离线` : '',
  ].filter(Boolean);
  return [`${devices.length} 台设备`, ...(tail.length ? tail : ['都歇着'])].join(' · ');
}

/** 按分组排好：有分组的按分组名，没分组的归「其他」放最后；组内保持服务端顺序。 */
export function groupByArea<T extends { area: string | null }>(devices: T[]) {
  const groups = new Map<string, T[]>();
  for (const device of devices) {
    const key = device.area?.trim() || '';
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh-CN')))
    .map(([area, items]) => ({ area: area || '其他', items }));
}

/** 目录顶部按类型筛的几个 chip。 */
export type SmartHomeKind = 'vacuum' | 'cover' | 'switch' | 'climate' | 'sensor' | 'other';
export const SMART_HOME_KINDS: { value: SmartHomeKind; label: string }[] = [
  { value: 'vacuum', label: '扫地机' },
  { value: 'cover', label: '窗帘' },
  { value: 'switch', label: '开关' },
  { value: 'climate', label: '空调' },
  { value: 'sensor', label: '传感器' },
  { value: 'other', label: '其他' },
];

export function smartHomeKind(domain: SmartHomeDomain): SmartHomeKind {
  if (domain === 'vacuum' || domain === 'cover' || domain === 'climate') return domain;
  if (domain === 'switch' || domain === 'light' || domain === 'input_boolean' || domain === 'fan') return 'switch';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'sensor';
  return 'other';
}

interface DirectoryEntryLike {
  entityId: string;
  domain: SmartHomeDomain;
  name: string;
  fullName: string;
  primary: boolean;
}

/**
 * 目录怎么摆：
 * - 没搜东西（或搜到的是设备名）：每台设备只摆主实体，其余折进「更多」；
 * - 搜到的是实体（名字 / friendly_name / entity_id）：命中的实体直接摆出来，诊断类也不折；
 * - chip 只按类型筛，折叠规则不变；一台设备筛完什么都不剩就不显示。
 */
export function arrangeDirectory<D extends { name: string; entities: DirectoryEntryLike[] }>(
  devices: D[],
  { query, kind }: { query: string; kind: SmartHomeKind | 'all' },
) {
  type E = D['entities'][number];
  const keyword = query.trim().toLowerCase();
  return devices
    .map((device) => {
      const candidates: E[] = device.entities.filter((entry) => kind === 'all' || smartHomeKind(entry.domain) === kind);
      if (keyword && !device.name.toLowerCase().includes(keyword)) {
        const hits = candidates.filter((entry) =>
          [entry.name, entry.fullName, entry.entityId].some((text) => text.toLowerCase().includes(keyword)),
        );
        return { device, shown: hits, more: [] as E[] };
      }
      return {
        device,
        shown: candidates.filter((entry) => entry.primary),
        more: candidates.filter((entry) => !entry.primary),
      };
    })
    .filter((group) => group.shown.length + group.more.length > 0);
}

/** 动作的中文名（审计列表、联动规则里用）。 */
export const SMART_HOME_ACTION_LABELS: Record<SmartHomeAction, string> = {
  start: '开始清扫',
  pause: '暂停',
  return_to_base: '回充',
  open: '打开',
  stop: '停',
  close: '关上',
  turn_on: '打开',
  turn_off: '关掉',
  activate: '执行',
  mode_cool: '制冷',
  mode_heat: '制热',
  mode_fan_only: '送风',
  mode_auto: '自动',
  temperature_up: '调高 1°',
  temperature_down: '调低 1°',
  set_position: '调位置',
  set_temperature: '设温度',
  set_hvac_mode: '换模式',
  set_fan_mode: '调风速',
  set_swing_mode: '调摆风',
  set_fan_speed: '调吸力',
  clean_area: '分房间清扫',
  select_option: '换选项',
  set_value: '调数值',
  press: '按一下',
};
