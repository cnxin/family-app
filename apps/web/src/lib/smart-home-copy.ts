import type { SmartHomeAction, SmartHomeDomain, SmartHomeEntityState } from '@family/contracts';

/** 一台设备在页面上的一句话状态。tone 决定颜色：on 高亮、warn 提醒、off 平常、muted 连不上。 */
export interface StateLine {
  text: string;
  detail: string | null;
  tone: 'on' | 'off' | 'warn' | 'muted';
}

const VACUUM: Record<string, [string, StateLine['tone']]> = {
  cleaning: ['正在清扫', 'on'],
  docked: ['在充电座上', 'off'],
  returning: ['正在回充', 'on'],
  paused: ['暂停了', 'warn'],
  idle: ['待机', 'off'],
  error: ['出错了，去 App 看看', 'warn'],
};

const COVER: Record<string, [string, StateLine['tone']]> = {
  open: ['开着', 'on'],
  closed: ['关着', 'off'],
  opening: ['正在打开', 'on'],
  closing: ['正在关上', 'on'],
};

/** binary_sensor 按 device_class 说人话；没有的就「是 / 否」。 */
const BINARY: Record<string, [string, string]> = {
  running: ['运行中', '没在运行'],
  problem: ['有问题', '正常'],
  door: ['开着', '关着'],
  window: ['开着', '关着'],
  opening: ['开着', '关着'],
  moisture: ['检测到水', '干的'],
  battery: ['电量低', '电量正常'],
  connectivity: ['在线', '离线'],
  plug: ['插着', '没插'],
};

const CLIMATE: Record<string, string> = {
  off: '关着',
  cool: '制冷',
  heat: '制热',
  heat_cool: '自动',
  auto: '自动',
  dry: '除湿',
  fan_only: '送风',
};

const UNITS: Record<string, string> = { min: '分钟', h: '小时', s: '秒', d: '天' };

function formatNumber(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
}

function sensorLine(state: SmartHomeEntityState, timeZone: string): StateLine {
  if (state.deviceClass === 'timestamp') {
    const at = new Date(state.state);
    if (Number.isNaN(at.getTime())) return { text: state.state, detail: null, tone: 'off' };
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(at);
    return { text: time, detail: null, tone: 'off' };
  }
  const value = formatNumber(state.state);
  const unit = state.unit ? UNITS[state.unit] ?? state.unit : '';
  const joined = unit && !/^[%°]/.test(unit) && /[一-龥]/.test(unit) ? `${value} ${unit}` : `${value}${unit}`;
  return { text: joined, detail: null, tone: 'off' };
}

export function smartHomeStateLine(
  domain: SmartHomeDomain,
  state: SmartHomeEntityState | null,
  timeZone = 'Asia/Shanghai',
): StateLine {
  if (!state) return { text: '—', detail: null, tone: 'muted' };
  if (state.state === 'unavailable') return { text: '离线', detail: null, tone: 'muted' };
  if (state.state === 'unknown') return { text: '不知道', detail: null, tone: 'muted' };

  switch (domain) {
    case 'vacuum': {
      const [text, tone] = VACUUM[state.state] ?? [state.state, 'off'];
      return { text, detail: state.battery == null ? null : `电量 ${state.battery}%`, tone };
    }
    case 'cover': {
      const [text, tone] = COVER[state.state] ?? [state.state, 'off'];
      const detail =
        state.position != null && state.state !== 'closed' && state.position !== 100 ? `开了 ${state.position}%` : null;
      return { text, detail, tone };
    }
    case 'light':
    case 'switch':
    case 'input_boolean':
    case 'fan':
    case 'humidifier':
      return state.state === 'on' ? { text: '开着', detail: null, tone: 'on' } : { text: '关着', detail: null, tone: 'off' };
    case 'binary_sensor': {
      const [on, off] = BINARY[state.deviceClass ?? ''] ?? ['是', '否'];
      return state.state === 'on' ? { text: on, detail: null, tone: 'on' } : { text: off, detail: null, tone: 'off' };
    }
    case 'climate':
    case 'water_heater': {
      const parts = [
        state.state !== 'off' && state.targetTemperature != null ? `设定 ${formatNumber(String(state.targetTemperature))}°` : null,
        state.currentTemperature != null ? `室内 ${formatNumber(String(state.currentTemperature))}°` : null,
      ].filter(Boolean);
      return {
        text: CLIMATE[state.state] ?? state.state,
        detail: parts.length ? parts.join(' · ') : null,
        tone: state.state === 'off' ? 'off' : 'on',
      };
    }
    case 'scene':
    case 'script':
      return { text: '场景', detail: null, tone: 'off' };
    case 'sensor':
    case 'number':
      return sensorLine(state, timeZone);
    case 'select':
    case 'text':
      return { text: state.state, detail: null, tone: 'off' };
    case 'button':
      // 按钮的状态是上次按的时间，卡片上没意义
      return { text: '按钮', detail: null, tone: 'off' };
  }
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
