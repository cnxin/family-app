import {
  SMART_HOME_READONLY_COVER_CLASSES,
  type SmartHomeAction,
  type SmartHomeChoice,
  type SmartHomeControl,
} from '@family/contracts';
import type { HomeAssistantRawState } from './home-assistant.client';
import type { HomeAssistantEntityRegistryEntry } from './home-assistant.ws';

// 详情面板的通用控件（smart-home-redesign §9.4、§9.5）。一个函数说「这个实体怎么渲染、能发哪些动作」，
// 另一个按 HA 当前属性校验值并算出要调的 service。面板端点和命令接口共用：看得见的才按得动，按得动的一定看得见。
// 数据只来自 HA 的通用属性（supported_features、options、min / max / step、fan_speed_list、area_mapping…），
// 不含任何按厂商、按集成的分支；选项的中文用 HA 自己的翻译，取不到才用下面这张通用词表。

/** HA 各 domain 的 supported_features 位（与 HA 源码的 *EntityFeature 一致）。 */
const COVER = { OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8 };
const VACUUM = { PAUSE: 4, RETURN_HOME: 16, FAN_SPEED: 32, START: 8192, CLEAN_AREA: 16384 };
const CLIMATE = { FAN_MODE: 8, SWING_MODE: 32 };

/** 常见原始值的中文（HA 翻译里没有时兜底）。 */
const WORDS: Record<string, string> = {
  auto: '自动', low: '低', medium: '中', middle: '中', mid: '中', high: '高', off: '关', on: '开',
  quiet: '安静', silent: '静音', gentle: '轻柔', balanced: '标准', standard: '标准', normal: '标准', strong: '强力',
  turbo: '强力', max: 'MAX', max_plus: 'MAX+', smart_mode: '智能', smart: '智能', custom: '自定义', slight: '轻微',
  moderate: '适中', extreme: '强力', deep: '深度', deep_plus: '深度+', fast: '快速',
  cool: '制冷', heat: '制热', heat_cool: '自动', dry: '除湿', fan_only: '送风',
  vertical: '上下摆', horizontal: '左右摆', both: '全摆',
};

export interface DescribeContext {
  raw: HomeAssistantRawState | undefined;
  registry: HomeAssistantEntityRegistryEntry | undefined;
  /** HA 翻译（key → 中文） */
  translations: Map<string, string>;
  /** HA 区域 id → 名字 */
  areaNames: Map<string, string>;
}

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : null);

function features(raw: HomeAssistantRawState | undefined): number | null {
  const value = raw?.attributes?.supported_features;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** HA 没报 supported_features 时当作都支持（老集成），真不支持 HA 自己会拒 */
const has = (flags: number | null, bit: number) => flags === null || (flags & bit) === bit;

function choices(values: string[], keys: (value: string) => string[], translations: Map<string, string>): SmartHomeChoice[] {
  return values.map((value) => {
    const translated = keys(value)
      .map((key) => translations.get(key))
      .find((text): text is string => Boolean(text));
    return { value, label: translated ?? WORDS[value] ?? value };
  });
}

/** 这个实体怎么渲染；null = 只读。排除名单、诊断类、藏掉、没权限由调用方先判断。 */
export function describeEntity(domain: string, context: DescribeContext): SmartHomeControl | null {
  const { raw, registry, translations, areaNames } = context;
  const attributes = raw?.attributes ?? {};
  const flags = features(raw);
  const platform = registry?.platform ?? '';
  const key = registry?.translation_key ?? '';
  switch (domain) {
    case 'switch':
    case 'input_boolean':
    case 'light':
    case 'fan':
    case 'humidifier':
      return { kind: 'toggle' };
    case 'button':
      return { kind: 'button' };
    case 'scene':
    case 'script':
      return { kind: 'scene' };
    case 'select': {
      const options = strings(attributes.options);
      if (!options?.length) return null;
      return {
        kind: 'select',
        options: choices(options, (value) => [`component.${platform}.entity.select.${key}.state.${value}`], translations),
      };
    }
    case 'number': {
      const min = numberOr(attributes.min, 0);
      const max = numberOr(attributes.max, 100);
      const step = numberOr(attributes.step, 1) || 1;
      if (!(max > min)) return null;
      const mode = attributes.mode;
      const display = mode === 'slider' ? 'slider' : mode === 'box' ? 'stepper' : (max - min) / step <= 100 ? 'slider' : 'stepper';
      const unit = typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : null;
      return { kind: 'number', min, max, step, unit, display };
    }
    case 'cover': {
      const deviceClass = typeof attributes.device_class === 'string' ? attributes.device_class : '';
      if ((SMART_HOME_READONLY_COVER_CLASSES as readonly string[]).includes(deviceClass)) return null;
      const actions = (
        [
          ['open', COVER.OPEN],
          ['stop', COVER.STOP],
          ['close', COVER.CLOSE],
        ] as const
      )
        .filter(([, bit]) => has(flags, bit))
        .map(([action]) => action);
      const position = typeof attributes.current_position === 'number' && flags !== null && (flags & COVER.SET_POSITION) > 0;
      return { kind: 'cover', actions, position };
    }
    case 'vacuum': {
      const actions = (
        [
          ['start', VACUUM.START],
          ['pause', VACUUM.PAUSE],
          ['return_to_base', VACUUM.RETURN_HOME],
        ] as const
      )
        .filter(([, bit]) => has(flags, bit))
        .map(([action]) => action);
      const speeds = strings(attributes.fan_speed_list);
      const fanSpeeds =
        speeds?.length && has(flags, VACUUM.FAN_SPEED)
          ? choices(
              speeds,
              (value) => [`component.${platform}.entity.vacuum.${key}.state_attributes.fan_speed.state.${value}`],
              translations,
            )
          : null;
      // 分房间：HA 2026.3 起的通用 CLEAN_AREA；房间 = 用户在 HA 里对应好的区域（options.vacuum.area_mapping）
      let areas: { id: string; name: string }[] | null = null;
      const mapping = (registry?.options?.vacuum as { area_mapping?: unknown } | undefined)?.area_mapping;
      if (flags !== null && (flags & VACUUM.CLEAN_AREA) > 0 && mapping && typeof mapping === 'object') {
        const mapped = Object.entries(mapping as Record<string, unknown>)
          .filter(([, segments]) => Array.isArray(segments) && segments.length > 0)
          .map(([id]) => ({ id, name: areaNames.get(id) ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        areas = mapped.length ? mapped : null;
      }
      return { kind: 'vacuum', actions, fanSpeeds, areas };
    }
    case 'climate': {
      const modes = (strings(attributes.hvac_modes) ?? []).filter((mode) => mode !== 'off');
      const fan = strings(attributes.fan_modes);
      const swing = strings(attributes.swing_modes);
      const attributeKey = (name: string) => (value: string) => [
        `component.${platform}.entity.climate.${key}.state_attributes.${name}.state.${value}`,
      ];
      return {
        kind: 'climate',
        hvacModes: choices(modes, (value) => [`component.${platform}.entity.climate.${key}.state.${value}`], translations),
        min: numberOr(attributes.min_temp, 16),
        max: numberOr(attributes.max_temp, 30),
        step: numberOr(attributes.target_temp_step, 0.5) || 0.5,
        fanModes: fan?.length && has(flags, CLIMATE.FAN_MODE) ? choices(fan, attributeKey('fan_mode'), translations) : null,
        swingModes:
          swing?.length && has(flags, CLIMATE.SWING_MODE) ? choices(swing, attributeKey('swing_mode'), translations) : null,
      };
    }
    default:
      return null;
  }
}

/** 每种 domain 可能有哪些动作（不看具体设备）：动作和实体类型根本对不上时先回 400，再谈权限。 */
const DOMAIN_ACTIONS: Record<string, readonly SmartHomeAction[]> = {
  vacuum: ['start', 'pause', 'return_to_base', 'set_fan_speed', 'clean_area'],
  cover: ['open', 'stop', 'close', 'set_position'],
  climate: [
    'turn_on', 'turn_off', 'mode_cool', 'mode_heat', 'mode_fan_only', 'mode_auto', 'temperature_up', 'temperature_down',
    'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode',
  ],
  switch: ['turn_on', 'turn_off'],
  input_boolean: ['turn_on', 'turn_off'],
  light: ['turn_on', 'turn_off'],
  fan: ['turn_on', 'turn_off'],
  humidifier: ['turn_on', 'turn_off'],
  scene: ['activate'],
  script: ['activate'],
  select: ['select_option'],
  number: ['set_value'],
  button: ['press'],
};

export function actionFitsDomain(domain: string, action: SmartHomeAction) {
  return (DOMAIN_ACTIONS[domain] ?? []).includes(action);
}

/** 值不对、此刻做不了：带 HTTP 状态，由命令服务转成 400 / 409。 */
export class SmartHomeControlError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface ServicePlan {
  /** 调哪个 domain 的 service（一般就是实体自己的 domain） */
  domain: string;
  service: string;
  data: Record<string, unknown>;
  /** 审计里记的，比如 select.select_option(high) */
  label: string;
}

const LEGACY_HVAC: Partial<Record<SmartHomeAction, string>> = {
  mode_cool: 'cool',
  mode_heat: 'heat',
  mode_fan_only: 'fan_only',
  mode_auto: 'auto',
};

function aligned(value: number, min: number, step: number) {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

function inChoices(value: unknown, list: SmartHomeChoice[] | null, what: string) {
  if (typeof value !== 'string' || !list?.some((choice) => choice.value === value)) {
    throw new SmartHomeControlError(400, `这台没有这个${what}`);
  }
  return value;
}

function plan(domain: string, service: string, data: Record<string, unknown> = {}, shown?: string | number): ServicePlan {
  return { domain, service, data, label: `${domain}.${service}${shown === undefined ? '' : `(${shown})`}` };
}

/**
 * 动作 + 值 → 要调的 HA service。值一律按 HA 此刻的属性校验（选项在不在、温度 / 数值在不在范围、对不对得上步长、
 * 区域是不是对应过的）。E2 时代的简单动作（开始清扫、调高 1° 之类）照旧支持，E4 的联动不用改。
 */
export function planCommand(
  domain: string,
  control: SmartHomeControl,
  action: SmartHomeAction,
  value: unknown,
  raw: HomeAssistantRawState | undefined,
): ServicePlan {
  const wrong = () => new SmartHomeControlError(400, '这台设备没有这个动作');
  switch (control.kind) {
    case 'toggle':
      if (action === 'turn_on' || action === 'turn_off') return plan(domain, action);
      throw wrong();
    case 'button':
      if (action === 'press') return plan(domain, 'press');
      throw wrong();
    case 'scene':
      if (action === 'activate') return plan(domain, 'turn_on');
      throw wrong();
    case 'select':
      if (action !== 'select_option') throw wrong();
      return plan(domain, 'select_option', { option: inChoices(value, control.options, '选项') }, String(value));
    case 'number': {
      if (action !== 'set_value') throw wrong();
      if (typeof value !== 'number' || value < control.min || value > control.max || !aligned(value, control.min, control.step)) {
        throw new SmartHomeControlError(400, `要在 ${control.min} ~ ${control.max} 之间，每次 ${control.step}`);
      }
      return plan(domain, 'set_value', { value }, value);
    }
    case 'cover': {
      const services = { open: 'open_cover', stop: 'stop_cover', close: 'close_cover' } as const;
      if (action === 'open' || action === 'stop' || action === 'close') {
        if (!control.actions.includes(action)) throw wrong();
        return plan(domain, services[action]);
      }
      if (action !== 'set_position' || !control.position) throw wrong();
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
        throw new SmartHomeControlError(400, '位置要是 0 ~ 100 的整数');
      }
      return plan(domain, 'set_cover_position', { position: value }, value);
    }
    case 'vacuum': {
      if (action === 'start' || action === 'pause' || action === 'return_to_base') {
        if (!control.actions.includes(action)) throw wrong();
        return plan(domain, action);
      }
      if (action === 'set_fan_speed') {
        return plan(domain, 'set_fan_speed', { fan_speed: inChoices(value, control.fanSpeeds, '吸力档位') }, String(value));
      }
      if (action !== 'clean_area' || !control.areas) throw wrong();
      const ids = Array.isArray(value) ? value : [];
      if (!ids.length || !ids.every((id) => control.areas!.some((area) => area.id === id))) {
        throw new SmartHomeControlError(400, '只能选 Home Assistant 里对应过的房间');
      }
      return plan(domain, 'clean_area', { cleaning_area_id: ids }, ids.join(','));
    }
    case 'climate': {
      if (action === 'turn_on' || action === 'turn_off') return plan(domain, action);
      const legacyMode = LEGACY_HVAC[action];
      if (legacyMode || action === 'set_hvac_mode') {
        const mode = legacyMode ?? value;
        if (mode !== 'off') inChoices(mode, control.hvacModes, '模式');
        return plan(domain, 'set_hvac_mode', { hvac_mode: mode }, String(mode));
      }
      if (action === 'set_fan_mode') {
        return plan(domain, 'set_fan_mode', { fan_mode: inChoices(value, control.fanModes, '风速') }, String(value));
      }
      if (action === 'set_swing_mode') {
        return plan(domain, 'set_swing_mode', { swing_mode: inChoices(value, control.swingModes, '摆风') }, String(value));
      }
      if (action === 'set_temperature') {
        if (typeof value !== 'number' || value < control.min || value > control.max || !aligned(value, control.min, control.step)) {
          throw new SmartHomeControlError(400, `温度要在 ${control.min}° ~ ${control.max}° 之间，每次 ${control.step}°`);
        }
        return plan(domain, 'set_temperature', { temperature: value }, value);
      }
      if (action === 'temperature_up' || action === 'temperature_down') {
        // E2 的「调高 1° / 调低 1°」：以 HA 里的设定温度为准，收在上下限里
        const current = raw?.attributes?.temperature;
        if (typeof current !== 'number') {
          throw new SmartHomeControlError(409, '读不到空调现在的设定温度，先在 Home Assistant 里设一次');
        }
        const next = Math.min(control.max, Math.max(control.min, current + (action === 'temperature_up' ? 1 : -1)));
        if (next === current) {
          throw new SmartHomeControlError(
            409,
            action === 'temperature_up' ? `已经是最高的 ${control.max}° 了` : `已经是最低的 ${control.min}° 了`,
          );
        }
        return plan(domain, 'set_temperature', { temperature: next }, next);
      }
      throw wrong();
    }
  }
}
