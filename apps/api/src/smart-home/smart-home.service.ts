import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  smartHomeActionsFor,
  SMART_HOME_READONLY_COVER_CLASSES,
  type SmartHomeConnection,
  type SmartHomeDevice as SmartHomeDeviceView,
  type SmartHomeDirectory,
  type SmartHomeEntityState,
  type SmartHomeMergeReport,
  type SmartHomeStates,
} from '@family/contracts';
import { Clock } from '../common/clock';
import { SmartHomeDevice, SmartHomeMergeReportRecord, type MemberRole } from '../entities';
import {
  HomeAssistantError,
  fetchHomeAssistantStates,
  friendlyName,
  pingHomeAssistant,
  presentHomeAssistantState,
  type HomeAssistantRawState,
} from './home-assistant.client';
import {
  fetchHomeAssistantRegistries,
  fetchHomeAssistantTranslations,
  type HomeAssistantRegistries,
} from './home-assistant.ws';
import { buildDirectory, type WhitelistIndex } from './smart-home-directory';
import { domainOf, haDeviceName, stripDeviceName } from './smart-home-devices';
import { SmartHomeSettingsService } from './smart-home-settings.service';

export { stripDeviceName } from './smart-home-devices';
export { presentSmartHomeDevice } from './smart-home-present';
import { presentSmartHomeDevice, UNAVAILABLE_STATE } from './smart-home-present';
export { buildDirectory } from './smart-home-directory';

/** 同一家庭几个人同时打开页面时合并成一次 HA 请求；连不上也缓存这么久，免得连点刷新一直等超时。 */
const STATES_CACHE_MS = 2_000;
/** 注册表（设备 / 实体 / 区域）变得很少：状态页、控制、订阅都读它，缓存一分钟。目录每次读新的。 */
const REGISTRY_CACHE_MS = 60_000;
const TRANSLATION_CACHE_MS = 3_600_000;

type Snapshot =
  | { ok: true; states: HomeAssistantRawState[]; checkedAt: Date }
  | { ok: false; configured: boolean; message: string; checkedAt: Date };

type RegistryResult = { ok: true; value: HomeAssistantRegistries } | { ok: false; message: string };

/** 这个人能不能控这台：设备开放了控制、主实体这类有动作，且角色够（minRole = member 时全家都行）。 */
export function canControlDevice(
  device: Pick<SmartHomeDeviceView, 'controllable' | 'primaryDomain' | 'minRole'>,
  role: MemberRole,
) {
  return (
    device.controllable &&
    smartHomeActionsFor(device.primaryDomain).length > 0 &&
    (device.minRole === 'member' || role === 'owner' || role === 'admin')
  );
}

export function isReadonlyCover(domain: string, deviceClass: string | null) {
  return domain === 'cover' && (SMART_HOME_READONLY_COVER_CLASSES as readonly string[]).includes(deviceClass ?? '');
}

function failureMessage(error: unknown) {
  return error instanceof HomeAssistantError ? error.message : '网络不通，Home Assistant 可能没开';
}

/**
 * 连接测试、实体目录、白名单（按设备）、状态快照。所有对 HA 的调用 3 秒超时，失败只影响这一页（§6.5）。
 * 控制（E2）、webhook（E3）不在这里；按实体 → 按设备的归并在 SmartHomeMergeService。
 */
@Injectable()
export class SmartHomeService {
  private readonly snapshots = new Map<string, { version: string; at: number; value: Promise<Snapshot> }>();
  /** 最近一次读成功的状态：HA 连不上时页面按它灰显（redesign §2.4） */
  private readonly lastGood = new Map<string, { version: string; states: HomeAssistantRawState[]; checkedAt: Date }>();
  private readonly registryCache = new Map<string, { version: string; at: number; value: Promise<RegistryResult> }>();
  private readonly translationCache = new Map<string, { key: string; at: number; value: Map<string, string> }>();
  /** 从哪一刻起连不上 HA（连上一次就清掉）：E5「HA 断开超过 1 小时」按它算。只在内存里，API 重启后从头计。 */
  private readonly unreachable = new Map<string, Date>();

  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    private readonly settings: SmartHomeSettingsService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /** 设置变了就丢掉缓存（版本号本身也会变，这里是为了立刻释放）。 */
  forget(householdId: string) {
    this.snapshots.delete(householdId);
  }

  /** 连接设置变了：上次的状态、注册表都不作数了。 */
  forgetAll(householdId: string) {
    this.snapshots.delete(householdId);
    this.unreachable.delete(householdId);
    this.lastGood.delete(householdId);
    this.registryCache.delete(householdId);
    this.translationCache.delete(householdId);
  }

  /** 读 HA 的结果记一笔（状态快照、实时订阅的轮询与重连都调）；ok 清零，失败只记第一次。 */
  noteReachable(householdId: string, ok: boolean) {
    if (ok) this.unreachable.delete(householdId);
    else if (!this.unreachable.has(householdId)) this.unreachable.set(householdId, this.clock.now());
  }

  unreachableSince(householdId: string): Date | null {
    return this.unreachable.get(householdId) ?? null;
  }

  async test(householdId: string): Promise<SmartHomeConnection> {
    this.forget(householdId);
    const { target } = await this.settings.resolve(householdId);
    const checkedAt = this.clock.now().toISOString();
    if (!target) {
      return { configured: false, available: false, checkedAt, message: '还没填 Home Assistant 地址和令牌', version: null };
    }
    try {
      const { version } = await pingHomeAssistant(target);
      return {
        configured: true,
        available: true,
        checkedAt,
        message: version ? `Home Assistant ${version}` : 'Home Assistant 已连接',
        version,
      };
    } catch (error) {
      return { configured: true, available: false, checkedAt, message: failureMessage(error), version: null };
    }
  }

  async list(householdId: string): Promise<SmartHomeDeviceView[]> {
    const rows = await this.rows(householdId);
    return rows.map((row) => presentSmartHomeDevice(row));
  }

  private rows(householdId: string) {
    return this.devices
      .createQueryBuilder('device')
      .where('device.householdId = :householdId', { householdId })
      .orderBy('device.area', 'ASC', 'NULLS LAST')
      .addOrderBy('device.sortOrder', 'ASC')
      .addOrderBy('device.displayName', 'ASC')
      .getMany();
  }

  async find(householdId: string, id: string) {
    return this.devices.findOne({ where: { householdId, id } });
  }

  async directory(householdId: string): Promise<SmartHomeDirectory> {
    const [snapshot, rows, registries] = await Promise.all([
      this.snapshot(householdId),
      this.devices.find({ where: { householdId } }),
      this.registries(householdId, { fresh: true }),
    ]);
    const connection = this.connection(snapshot);
    if (!snapshot.ok) return { connection, grouped: false, groupingMessage: null, devices: [] };
    const whitelist: WhitelistIndex = {
      byHaDevice: new Map(rows.filter((row) => row.haDeviceId).map((row) => [row.haDeviceId as string, row.id])),
      byEntity: new Map(rows.filter((row) => !row.haDeviceId).map((row) => [row.primaryEntityId, row.id])),
    };
    return {
      connection,
      grouped: registries.ok,
      groupingMessage: registries.ok ? null : `没读到设备信息（${registries.message}），先按实体平铺`,
      devices: buildDirectory(snapshot.states, registries.ok ? registries.value : null, whitelist),
    };
  }

  async states(householdId: string, role: MemberRole): Promise<SmartHomeStates> {
    // 注册表只用来给主面板项起名（去设备名前缀），和读状态并行：HA 不回时总共只等一次超时
    const [read, rows, registries] = await Promise.all([
      this.readStates(householdId),
      this.rows(householdId),
      this.registries(householdId),
    ]);
    const { byId } = read;
    const deviceNames = new Map(
      registries.ok ? registries.value.devices.map((device) => [device.id, haDeviceName(device)]) : [],
    );
    const present = (entityId: string) => this.presentState(byId, entityId);
    return {
      connection: read.connection,
      stale: read.stale,
      asOf: read.asOf,
      devices: rows.map((row) => {
        const device = presentSmartHomeDevice(row);
        const primary = present(row.primaryEntityId);
        const deviceName = row.haDeviceId ? deviceNames.get(row.haDeviceId) ?? null : null;
        return {
          ...device,
          primary,
          featured: device.featuredEntityIds.map((entityId) => {
            const raw = byId?.get(entityId);
            return {
              entityId,
              domain: domainOf(entityId),
              name: raw ? stripDeviceName(friendlyName(raw), deviceName ?? row.displayName) : entityId,
              state: present(entityId),
            };
          }),
          online: Boolean(primary && primary.state !== 'unavailable'),
          canControl: canControlDevice(device, role),
        };
      }),
    };
  }

  /**
   * 读状态：连得上用最新的；连不上用最近一次读成功的（stale，页面灰显，redesign §2.4）；
   * 连接设置改过或 API 重启后还没读到过，byId 为 null。
   */
  async readStates(householdId: string) {
    const [snapshot, { version }] = await Promise.all([this.snapshot(householdId), this.settings.resolve(householdId)]);
    const last = this.lastGood.get(householdId);
    const fallback = !snapshot.ok && snapshot.configured && last?.version === version ? last : null;
    const states = snapshot.ok ? snapshot.states : fallback?.states ?? null;
    return {
      snapshot,
      live: snapshot.ok,
      connection: this.connection(snapshot),
      stale: Boolean(fallback),
      asOf: snapshot.ok ? snapshot.checkedAt.toISOString() : fallback?.checkedAt.toISOString() ?? null,
      byId: states ? new Map(states.map((raw) => [raw.entity_id, raw])) : null,
    };
  }

  /** 一个实体此刻的样子；HA 上已经没有的按 unavailable，整个读不到为 null。 */
  presentState(byId: Map<string, HomeAssistantRawState> | null, entityId: string): SmartHomeEntityState | null {
    if (!byId) return null;
    const raw = byId.get(entityId);
    return raw ? presentHomeAssistantState(raw) : { ...UNAVAILABLE_STATE };
  }

  /**
   * 一台设备的上下文（详情面板、子实体控制共用）：它名下有哪些子实体（HA 注册表；读不到时退回库里记着的）、
   * 各自的注册表条目、HA 翻译、区域名。
   */
  async deviceContext(row: SmartHomeDevice) {
    const [read, registries] = await Promise.all([this.readStates(row.householdId), this.registries(row.householdId)]);
    const registry = registries.ok ? registries.value : null;
    const device = row.haDeviceId ? registry?.devices.find((one) => one.id === row.haDeviceId) : undefined;
    const entries = new Map(
      (registry?.entities ?? [])
        .filter((entry) =>
          row.haDeviceId ? entry.device_id === row.haDeviceId : entry.entity_id === row.primaryEntityId,
        )
        .map((entry) => [entry.entity_id, entry]),
    );
    const ids =
      row.haDeviceId && registry
        ? [...entries.values()].filter((entry) => !entry.disabled_by && !entry.hidden_by).map((entry) => entry.entity_id)
        : [...new Set([row.primaryEntityId, ...(row.featuredEntityIds ?? []), ...(row.knownEntityIds ?? [])])];
    if (!ids.includes(row.primaryEntityId)) ids.unshift(row.primaryEntityId);
    const platforms = [...new Set([...entries.values()].map((entry) => entry.platform).filter((one): one is string => Boolean(one)))];
    const translations = await this.translations(row.householdId, platforms);
    return {
      ...read,
      registryOk: Boolean(registry),
      device,
      deviceName: haDeviceName(device),
      entries,
      ids,
      translations,
      areaNames: new Map(registry?.areas.map((area) => [area.area_id, area.name]) ?? []),
    };
  }

  /** HA 翻译（select 选项、吸力档位的中文），按家庭 + 集成缓存一小时；取不到就空表（调用方用内置词表）。 */
  private async translations(householdId: string, platforms: string[]) {
    const { target, version } = await this.settings.resolve(householdId);
    if (!target || !platforms.length) return new Map<string, string>();
    const key = `${version}:${[...platforms].sort().join(',')}`;
    const cached = this.translationCache.get(householdId);
    if (cached && cached.key === key && Date.now() - cached.at < TRANSLATION_CACHE_MS) return cached.value;
    const value = await fetchHomeAssistantTranslations(target, platforms).catch(() => null);
    if (value) this.translationCache.set(householdId, { key, at: Date.now(), value });
    return value ?? new Map<string, string>();
  }

  /** 最新的 HA 状态（走 2 秒缓存）；连不上时 null。控制前查 device_class 用。 */
  async currentState(householdId: string, entityId: string) {
    const snapshot = await this.snapshot(householdId);
    if (!snapshot.ok) return null;
    const raw = snapshot.states.find((entry) => entry.entity_id === entityId);
    return raw ? presentHomeAssistantState(raw) : null;
  }

  /** 这台设备现在能引用哪些子实体：HA 注册表里它名下的（能读到时），加上库里记着的。 */
  async entitiesOf(row: SmartHomeDevice) {
    const ids = new Set([row.primaryEntityId, ...(row.featuredEntityIds ?? []), ...(row.knownEntityIds ?? [])]);
    if (row.haDeviceId) {
      const registries = await this.registries(row.householdId);
      if (registries.ok) {
        for (const entry of registries.value.entities) {
          if (entry.device_id === row.haDeviceId && !entry.disabled_by) ids.add(entry.entity_id);
        }
      }
    }
    return ids;
  }

  async mergeReport(householdId: string): Promise<SmartHomeMergeReport | null> {
    const row = await this.dataSource.getRepository(SmartHomeMergeReportRecord).findOne({ where: { householdId } });
    return (row?.report as SmartHomeMergeReport | undefined) ?? null;
  }

  /** 实时订阅要盯的实体：白名单设备名下的全部子实体（详情面板开着也要能实时变），读不到注册表时退回库里记着的。 */
  async watchedEntityIds(householdId: string) {
    const rows = await this.devices.find({ where: { householdId } });
    const ids = new Set<string>();
    for (const row of rows) for (const entityId of await this.entitiesOf(row)) ids.add(entityId);
    return ids;
  }

  /** 设备 / 实体 / 区域注册表（WebSocket）。fresh 时不走缓存（目录、加设备、归并）。 */
  async registries(householdId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<RegistryResult> {
    const { target, version } = await this.settings.resolve(householdId);
    if (!target) return { ok: false, message: '还没连上 Home Assistant' };
    const cached = this.registryCache.get(householdId);
    const now = Date.now();
    if (!fresh && cached && cached.version === version && now - cached.at < REGISTRY_CACHE_MS) return cached.value;
    const value: Promise<RegistryResult> = fetchHomeAssistantRegistries(target).then(
      (registries): RegistryResult => ({ ok: true, value: registries }),
      (error): RegistryResult => ({ ok: false, message: failureMessage(error) }),
    );
    this.registryCache.set(householdId, { version, at: now, value });
    const result = await value;
    // 失败的别缓存一分钟：下一次立刻重试
    if (!result.ok) this.registryCache.delete(householdId);
    return result;
  }

  async snapshot(householdId: string): Promise<Snapshot> {
    const { target, version } = await this.settings.resolve(householdId);
    const cached = this.snapshots.get(householdId);
    const now = Date.now();
    if (cached && cached.version === version && now - cached.at < STATES_CACHE_MS) return cached.value;
    const value: Promise<Snapshot> = target
      ? fetchHomeAssistantStates(target).then(
          (states): Snapshot => {
            const checkedAt = this.clock.now();
            this.lastGood.set(householdId, { version, states, checkedAt });
            this.noteReachable(householdId, true);
            return { ok: true, states, checkedAt };
          },
          (error): Snapshot => {
            this.noteReachable(householdId, false);
            return { ok: false, configured: true, message: failureMessage(error), checkedAt: this.clock.now() };
          },
        )
      : Promise.resolve({ ok: false, configured: false, message: '还没连上 Home Assistant', checkedAt: this.clock.now() });
    this.snapshots.set(householdId, { version, at: now, value });
    return value;
  }

  private connection(snapshot: Snapshot): SmartHomeConnection {
    return snapshot.ok
      ? { configured: true, available: true, checkedAt: snapshot.checkedAt.toISOString(), message: '已连接', version: null }
      : {
          configured: snapshot.configured,
          available: false,
          checkedAt: snapshot.checkedAt.toISOString(),
          message: snapshot.message,
          version: null,
        };
  }
}
