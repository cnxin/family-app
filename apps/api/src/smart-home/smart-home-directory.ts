import {
  SMART_HOME_DOMAINS,
  SMART_HOME_PRIMARY_LIMIT,
  isPrimarySmartHomeEntity,
  type SmartHomeDirectoryDevice,
  type SmartHomeDirectoryEntry,
} from '@family/contracts';
import { friendlyName, presentHomeAssistantState, type HomeAssistantRawState } from './home-assistant.client';
import type { HomeAssistantRegistries } from './home-assistant.ws';
import { domainOf, entitiesOfDevice, haDeviceName, pickDefaults, stripDeviceName } from './smart-home-devices';

// 实体目录（管理员挑白名单用）：按 HA 设备分组，每台默认只展开几个主实体，标出整台「加进来」时的默认搭配。

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-CN');
const isSensor = (domain: string) => domain === 'sensor' || domain === 'binary_sensor';
const isSupported = (domain: string): domain is SmartHomeDirectoryEntry['domain'] =>
  (SMART_HOME_DOMAINS as readonly string[]).includes(domain);

/** 白名单现状，目录要知道哪台设备 / 哪个无主实体已经加过。 */
export interface WhitelistIndex {
  byHaDevice: Map<string, string>;
  byEntity: Map<string, string>;
}

/** 按设备分组拼目录。registries 为 null（WebSocket 读不到）时退回一组平铺。 */
export function buildDirectory(
  states: HomeAssistantRawState[],
  registries: HomeAssistantRegistries | null,
  whitelist: WhitelistIndex,
): SmartHomeDirectoryDevice[] {
  const entityRegistry = new Map(registries?.entities.map((entry) => [entry.entity_id, entry]) ?? []);
  const deviceRegistry = new Map(registries?.devices.map((device) => [device.id, device]) ?? []);
  const areaNames = new Map(registries?.areas.map((area) => [area.area_id, area.name]) ?? []);
  const statesById = new Map(states.map((raw) => [raw.entity_id, raw]));
  const groups = new Map<string | null, SmartHomeDirectoryEntry[]>();

  for (const raw of states) {
    const domain = domainOf(raw.entity_id);
    if (!isSupported(domain)) continue;
    const entry = entityRegistry.get(raw.entity_id);
    // 在 HA 里停用或隐藏的实体：用户已经表过态了，目录里不列
    if (entry?.disabled_by || entry?.hidden_by) continue;
    const device = entry?.device_id ? deviceRegistry.get(entry.device_id) : undefined;
    // HA 自己的服务型「设备」（Backup、Sun 之类）不是家里的东西
    if (device?.disabled_by || device?.entry_type === 'service') continue;
    const deviceName = device ? device.name_by_user || device.name || null : null;
    const category = entry?.entity_category ?? null;
    const fullName = friendlyName(raw);
    const name = stripDeviceName(fullName, deviceName);
    const whitelistedDevice = device ? whitelist.byHaDevice.get(device.id) : whitelist.byEntity.get(raw.entity_id);
    const item: SmartHomeDirectoryEntry = {
      entityId: raw.entity_id,
      domain,
      name,
      fullName,
      state: presentHomeAssistantState(raw),
      whitelisted: Boolean(whitelistedDevice),
      category,
      // 先标候选，分完组再按每台设备的名额收紧
      primary: isPrimarySmartHomeEntity(domain, category, name),
      defaultRole: null,
    };
    const key = device ? device.id : null;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const result = [...groups.entries()].map(([id, entities]): SmartHomeDirectoryDevice => {
    const device = id ? deviceRegistry.get(id) : undefined;
    // 每台设备最多展开 SMART_HOME_PRIMARY_LIMIT 个：可控类优先，剩下的位置给传感器
    entities
      .filter((entry) => entry.primary)
      .sort((a, b) => Number(isSensor(a.domain)) - Number(isSensor(b.domain)) || byName(a, b))
      .slice(SMART_HOME_PRIMARY_LIMIT)
      .forEach((entry) => {
        entry.primary = false;
      });
    // 整台「加进来」时的默认搭配，和 add() 用同一套规则
    if (id && registries) {
      const defaults = pickDefaults(
        entitiesOfDevice(id, registries, statesById),
        haDeviceName(device),
        device?.model ?? null,
      );
      for (const entry of entities) {
        entry.defaultRole =
          entry.entityId === defaults.primary?.entityId
            ? 'primary'
            : defaults.featured.includes(entry.entityId)
              ? 'featured'
              : null;
      }
    }
    return {
      id,
      name: device ? device.name_by_user || device.name || '未命名设备' : registries ? '没有归属设备的' : '全部实体',
      area: device?.area_id ? areaNames.get(device.area_id) ?? null : null,
      manufacturer: device?.manufacturer ?? null,
      model: device?.model ?? null,
      // 主实体在前；主实体里设备本体（扫地机、窗帘这类）排在它的传感器前面
      entities: entities.sort(
        (a, b) =>
          Number(b.primary) - Number(a.primary) || Number(isSensor(a.domain)) - Number(isSensor(b.domain)) || byName(a, b),
      ),
      whitelistedDeviceId: id ? whitelist.byHaDevice.get(id) ?? null : null,
    };
  });
  return result.sort((a, b) => {
    if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
    if ((a.area === null) !== (b.area === null)) return a.area === null ? 1 : -1;
    return (a.area ?? '').localeCompare(b.area ?? '', 'zh-CN') || byName(a, b);
  });
}
