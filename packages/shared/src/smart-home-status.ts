// 智能家居设备的一句状态（smart-home-redesign §3.1），与控制页卡片同一套说法。
// J4 第四批从 web 搬来给服务端用（小管家读工具 get_device_status）；第四批收尾起 web 也从这里引，只留这一份。
// 单测在 packages/shared/tests/smart-home-status.test.mjs。类型写成结构类型：本包不依赖 contracts。

/** 一个实体的状态里用得上的字段（contracts 的 SmartHomeEntityState 满足它）。 */
export interface SmartHomeStateLike {
  state: string;
  unit: string | null;
  deviceClass: string | null;
  position: number | null;
  battery: number | null;
  targetTemperature: number | null;
  currentTemperature: number | null;
}

/** 一句状态。tone 决定颜色：on 高亮、warn 提醒、off 平常、muted 连不上。 */
export interface SmartHomeStatusLine {
  text: string;
  detail: string | null;
  tone: 'on' | 'off' | 'warn' | 'muted';
}

export interface SmartHomeDeviceLike {
  icon: string;
  primaryDomain: string;
  primary: SmartHomeStateLike | null;
  featured: { entityId: string; domain: string; name: string; state: SmartHomeStateLike | null }[];
}

const VACUUM: Record<string, [string, SmartHomeStatusLine['tone']]> = {
  cleaning: ['正在清扫', 'on'],
  docked: ['在充电座上', 'off'],
  returning: ['正在回充', 'on'],
  paused: ['暂停了', 'warn'],
  idle: ['待机', 'off'],
  error: ['出错了，去 App 看看', 'warn'],
};

const COVER: Record<string, [string, SmartHomeStatusLine['tone']]> = {
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

const CLIMATE_MODES: Record<string, string> = {
  cool: '制冷', heat: '制热', heat_cool: '自动', auto: '自动', dry: '除湿', fan_only: '送风',
};

const UNITS: Record<string, string> = { min: '分钟', h: '小时', s: '秒', d: '天' };

function formatNumber(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
}

function sensorLine(state: SmartHomeStateLike, timeZone: string): SmartHomeStatusLine {
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

/** 一个实体按它的 domain 说的一句状态（卡片之外的主面板项也用它）。 */
export function smartHomeStateLine(
  domain: string,
  state: SmartHomeStateLike | null,
  timeZone = 'Asia/Shanghai',
): SmartHomeStatusLine {
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
      return { text: '按钮', detail: null, tone: 'off' };
    default:
      return { text: state.state, detail: null, tone: 'off' };
  }
}

const numberOf = (state: SmartHomeStateLike | null) => {
  if (!state) return null;
  const value = Number(state.state);
  return state.state.trim() !== '' && Number.isFinite(value) ? value : null;
};

const trim = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ''));

/** 百分比类的传感器：单位是 %，或者名字里写着「百分比」（海尔净水器的滤芯就是这样、没单位）。 */
export function isPercentEntity(entity: { name: string; state: SmartHomeStateLike | null }) {
  return numberOf(entity.state) !== null && (entity.state?.unit === '%' || /百分比|percent/i.test(entity.name));
}

/** 剩余时长类的主面板项（洗衣机、烘干机的「剩余时间」）。 */
function remaining(device: SmartHomeDeviceLike) {
  for (const entity of device.featured) {
    const value = numberOf(entity.state);
    if (value === null || value <= 0) continue;
    const unit = entity.state?.unit ?? '';
    const isDuration = entity.state?.deviceClass === 'duration' || /^(min|h|s)$/.test(unit);
    if (!isDuration || !/剩|remain|left/i.test(entity.name)) continue;
    if (unit === 'h') return `剩 ${trim(value)} 小时`;
    if (unit === 's') return `剩 ${Math.ceil(value / 60)} 分钟`;
    return `剩 ${trim(value)} 分钟`;
  }
  return null;
}

/**
 * 一台设备的一句状态。long = 详情头部用的完整版（多带电量、室内温度这类）。
 * tone 决定颜色：on 运行 / 开着、off 关着 / 待机、warn 要留意、muted 离线或读不到。
 */
export function deviceStatusLine(device: SmartHomeDeviceLike, { long = false } = {}): SmartHomeStatusLine {
  const state = device.primary;
  if (!state) return { text: '—', detail: null, tone: 'muted' };
  if (state.state === 'unavailable') return { text: '离线', detail: null, tone: 'muted' };
  const base = smartHomeStateLine(device.primaryDomain, state);
  switch (device.icon) {
    case 'vacuum': {
      const battery = state.battery;
      if (state.state === 'docked' && battery != null && battery < 100) return { text: `充电中 ${battery}%`, detail: null, tone: 'off' };
      if (battery == null) return { ...base, detail: null };
      return { text: `${base.text} · ${long ? '电量 ' : ''}${battery}%`, detail: null, tone: base.tone };
    }
    case 'curtain':
      if (state.state === 'open' && state.position != null && state.position > 0 && state.position < 100) {
        return { text: `开了 ${state.position}%`, detail: null, tone: 'on' };
      }
      return { ...base, detail: null };
    case 'air_conditioner': {
      if (state.state === 'off') return { text: '已关', detail: null, tone: 'off' };
      const mode = CLIMATE_MODES[state.state] ?? state.state;
      const target = state.targetTemperature != null ? ` ${trim(state.targetTemperature)}°` : '';
      const inside = long && state.currentTemperature != null ? ` · 室内 ${trim(state.currentTemperature)}°` : '';
      return { text: `${mode}${target}${inside}`, detail: null, tone: 'on' };
    }
    case 'washer':
    case 'dryer': {
      const left = remaining(device);
      if (left) return { text: left, detail: null, tone: 'on' };
      return { ...base, detail: null };
    }
    case 'water_purifier': {
      // 几支滤芯取最低的那支：家里人关心的是「快不快该换了」
      const values = [{ name: '', state }, ...device.featured]
        .filter((entity) => isPercentEntity(entity))
        .map((entity) => numberOf(entity.state) as number);
      if (values.length) {
        const lowest = Math.min(...values);
        return { text: `滤芯剩 ${trim(lowest)}%`, detail: null, tone: lowest <= 10 ? 'warn' : 'off' };
      }
      return { ...base, detail: null };
    }
    case 'switch':
    case 'light':
    case 'fan':
      return state.state === 'on' ? { text: '开着', detail: null, tone: 'on' } : { text: '已关', detail: null, tone: 'off' };
    default:
      return { ...base, detail: long ? base.detail : null };
  }
}
