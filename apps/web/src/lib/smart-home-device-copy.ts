import type { SmartHomeEntityState, SmartHomeIcon } from '@family/contracts';
import { smartHomeStateLine, type StateLine } from './smart-home-copy';

// 设备级的一句状态（smart-home-redesign §3.1）：卡片用短的，详情头部用长的。
// 只看主实体和主面板项，按图标类型挑说法；不认厂商。

export interface DeviceLike {
  icon: SmartHomeIcon;
  primaryDomain: string;
  primary: SmartHomeEntityState | null;
  featured: { entityId: string; domain: string; name: string; state: SmartHomeEntityState | null }[];
}

const CLIMATE_MODES: Record<string, string> = {
  cool: '制冷', heat: '制热', heat_cool: '自动', auto: '自动', dry: '除湿', fan_only: '送风',
};

const numberOf = (state: SmartHomeEntityState | null) => {
  if (!state) return null;
  const value = Number(state.state);
  return state.state.trim() !== '' && Number.isFinite(value) ? value : null;
};

const trim = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ''));

/** 百分比类的传感器：单位是 %，或者名字里写着「百分比」（海尔净水器的滤芯就是这样、没单位）。 */
export function isPercentEntity(entity: { name: string; state: SmartHomeEntityState | null }) {
  return numberOf(entity.state) !== null && (entity.state?.unit === '%' || /百分比|percent/i.test(entity.name));
}

/** 百分比类传感器的短名：「初滤剩余百分比」→「初滤剩余」。 */
export function percentLabel(name: string) {
  return name.replace(/百分比$/, '').trim() || name;
}

/** 剩余时长类的主面板项（洗衣机、烘干机的「剩余时间」）。 */
function remaining(device: DeviceLike) {
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
export function deviceStatusLine(device: DeviceLike, { long = false } = {}): StateLine {
  const state = device.primary;
  if (!state) return { text: '—', detail: null, tone: 'muted' };
  if (state.state === 'unavailable') return { text: '离线', detail: null, tone: 'muted' };
  const base = smartHomeStateLine(device.primaryDomain as never, state);
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
