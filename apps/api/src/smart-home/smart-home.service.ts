import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  SMART_HOME_BLOCKED_DOMAINS,
  SMART_HOME_DOMAINS,
  type SmartHomeConnection,
  isPrimarySmartHomeEntity,
  SMART_HOME_PRIMARY_LIMIT,
  smartHomeActionsFor,
  SMART_HOME_READONLY_COVER_CLASSES,
  type SmartHomeDevice as SmartHomeDeviceView,
  type SmartHomeDirectory,
  type SmartHomeDirectoryDevice,
  type SmartHomeDirectoryEntry,
  type SmartHomeDomain,
  type SmartHomeStates,
  type UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { SmartHomeDevice, type MemberRole } from '../entities';
import {
  HomeAssistantError,
  fetchHomeAssistantStates,
  friendlyName,
  pingHomeAssistant,
  presentHomeAssistantState,
  type HomeAssistantRawState,
} from './home-assistant.client';
import { fetchHomeAssistantRegistries, type HomeAssistantRegistries } from './home-assistant.ws';
import { SmartHomeSettingsService } from './smart-home-settings.service';

/** 同一家庭几个人同时打开页面时合并成一次 HA 请求；连不上也缓存这么久，免得连点刷新一直等超时。 */
const STATES_CACHE_MS = 2_000;
const PAGE_PATH = '/house/smart-home';

type Snapshot =
  | { ok: true; states: HomeAssistantRawState[]; checkedAt: Date }
  | { ok: false; configured: boolean; message: string; checkedAt: Date };

/** 这个人能不能控这台：设备开放了控制、这类有动作，且角色够（minRole = member 时全家都行）。 */
export function canControlDevice(device: SmartHomeDeviceView, role: MemberRole) {
  return (
    device.controllable &&
    smartHomeActionsFor(device.domain).length > 0 &&
    (device.minRole === 'member' || role === 'owner' || role === 'admin')
  );
}

export function isReadonlyCover(domain: string, deviceClass: string | null) {
  return domain === 'cover' && (SMART_HOME_READONLY_COVER_CLASSES as readonly string[]).includes(deviceClass ?? '');
}

function domainOf(entityId: string) {
  return entityId.slice(0, entityId.indexOf('.'));
}

function isSupported(domain: string): domain is SmartHomeDomain {
  return (SMART_HOME_DOMAINS as readonly string[]).includes(domain);
}

function failureMessage(error: unknown) {
  return error instanceof HomeAssistantError ? error.message : '网络不通，Home Assistant 可能没开';
}

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

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-CN');
const isSensor = (domain: string) => domain === 'sensor' || domain === 'binary_sensor';

/** 按设备分组拼目录。registries 为 null（WebSocket 读不到）时退回一组平铺。 */
export function buildDirectory(
  states: HomeAssistantRawState[],
  registries: HomeAssistantRegistries | null,
  whitelisted: Set<string>,
): SmartHomeDirectoryDevice[] {
  const entityRegistry = new Map(registries?.entities.map((entry) => [entry.entity_id, entry]) ?? []);
  const deviceRegistry = new Map(registries?.devices.map((device) => [device.id, device]) ?? []);
  const areaNames = new Map(registries?.areas.map((area) => [area.area_id, area.name]) ?? []);
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
    const item: SmartHomeDirectoryEntry = {
      entityId: raw.entity_id,
      domain,
      name,
      fullName,
      state: presentHomeAssistantState(raw),
      whitelisted: whitelisted.has(raw.entity_id),
      category,
      // 先标候选，分完组再按每台设备的名额收紧
      primary: isPrimarySmartHomeEntity(domain, category, name),
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
    };
  });
  return result.sort((a, b) => {
    if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
    if ((a.area === null) !== (b.area === null)) return a.area === null ? 1 : -1;
    return (a.area ?? '').localeCompare(b.area ?? '', 'zh-CN') || byName(a, b);
  });
}

/**
 * E1：实体目录、白名单、只读状态。所有对 HA 的调用 3 秒超时，失败只影响这一页（§6.5）。
 * 控制（E2）、webhook（E3）不在这里。
 */
@Injectable()
export class SmartHomeService {
  private readonly snapshots = new Map<string, { version: string; at: number; value: Promise<Snapshot> }>();

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
    const rows = await this.devices
      .createQueryBuilder('device')
      .where('device.householdId = :householdId', { householdId })
      .orderBy('device.area', 'ASC', 'NULLS LAST')
      .addOrderBy('device.sortOrder', 'ASC')
      .addOrderBy('device.displayName', 'ASC')
      .getMany();
    return rows.map((row) => this.presentDevice(row));
  }

  async directory(householdId: string): Promise<SmartHomeDirectory> {
    const [snapshot, rows, registries] = await Promise.all([
      this.snapshot(householdId),
      this.devices.find({ where: { householdId }, select: { entityId: true } }),
      this.registries(householdId),
    ]);
    const connection = this.connection(snapshot);
    if (!snapshot.ok) return { connection, grouped: false, groupingMessage: null, devices: [] };
    return {
      connection,
      grouped: registries.ok,
      groupingMessage: registries.ok ? null : `没读到设备信息（${registries.message}），先按实体平铺`,
      devices: buildDirectory(
        snapshot.states,
        registries.ok ? registries.value : null,
        new Set(rows.map((row) => row.entityId)),
      ),
    };
  }

  async states(householdId: string, role: MemberRole): Promise<SmartHomeStates> {
    const [snapshot, devices] = await Promise.all([this.snapshot(householdId), this.list(householdId)]);
    const byId = snapshot.ok ? new Map(snapshot.states.map((raw) => [raw.entity_id, raw])) : null;
    return {
      connection: this.connection(snapshot),
      devices: devices.map((device) => {
        const raw = byId?.get(device.entityId);
        // HA 上已经没有这个实体（被删了、改了 ID）：按 HA 自己的说法当 unavailable
        const state = byId
          ? raw
            ? presentHomeAssistantState(raw)
            : { state: 'unavailable', unit: null, deviceClass: null, position: null, battery: null, lastChanged: null }
          : null;
        return { ...device, state, canControl: canControlDevice(device, role) };
      }),
    };
  }

  /** 最新的 HA 状态（走 2 秒缓存）；连不上时 null。控制前查 device_class 用。 */
  async currentState(householdId: string, entityId: string) {
    const snapshot = await this.snapshot(householdId);
    if (!snapshot.ok) return null;
    const raw = snapshot.states.find((entry) => entry.entity_id === entityId);
    return raw ? presentHomeAssistantState(raw) : null;
  }

  async upsert(entityId: string, input: UpsertSmartHomeDeviceBody, user: JwtUser) {
    const domain = domainOf(entityId);
    if ((SMART_HOME_BLOCKED_DOMAINS as readonly string[]).includes(domain)) {
      throw new BadRequestException('门锁和安防不接进小管家');
    }
    if (!isSupported(domain)) {
      throw new BadRequestException('这类实体第一期还不支持');
    }
    if (input.controllable) {
      if (!smartHomeActionsFor(domain).length) {
        throw new BadRequestException('这类设备只能看，不能在小管家里控制');
      }
      const state = await this.currentState(user.householdId, entityId);
      if (isReadonlyCover(domain, state?.deviceClass ?? null)) {
        throw new BadRequestException('车库门、大门这类只读，不能在小管家里控制');
      }
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SmartHomeDevice);
      const existing = await repository.findOne({ where: { householdId: user.householdId, entityId } });
      const row =
        existing ??
        repository.create({
          householdId: user.householdId,
          entityId,
          domain,
          sortOrder: await repository.count({ where: { householdId: user.householdId } }),
        });
      row.displayName = input.displayName;
      if (input.area !== undefined) row.area = input.area?.trim() || null;
      if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
      if (input.minRole !== undefined) row.minRole = input.minRole;
      if (input.controllable !== undefined) row.controllable = input.controllable;
      const result = await repository.save(row);
      await recordActivity(manager, user, {
        module: 'system',
        action: existing ? 'smart_home_device_updated' : 'smart_home_device_added',
        summary: existing ? `改了智能家居设备「${result.displayName}」` : `把「${result.displayName}」加进了智能家居`,
        targetPath: PAGE_PATH,
        metadata: { entityId },
      });
      return result;
    });
    return this.presentDevice(saved);
  }

  async remove(entityId: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SmartHomeDevice);
      const existing = await repository.findOne({ where: { householdId: user.householdId, entityId } });
      if (!existing) throw new NotFoundException('白名单里没有这个设备');
      await repository.delete(existing.id);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_device_removed',
        summary: `把「${existing.displayName}」移出了智能家居`,
        targetPath: PAGE_PATH,
        metadata: { entityId },
      });
    });
    return { entityId };
  }

  /** 设备 / 实体 / 区域注册表（WebSocket）。目录是管理员偶尔打开的，不缓存。 */
  private async registries(
    householdId: string,
  ): Promise<{ ok: true; value: HomeAssistantRegistries } | { ok: false; message: string }> {
    const { target } = await this.settings.resolve(householdId);
    if (!target) return { ok: false, message: '还没连上 Home Assistant' };
    try {
      return { ok: true, value: await fetchHomeAssistantRegistries(target) };
    } catch (error) {
      return { ok: false, message: failureMessage(error) };
    }
  }

  private async snapshot(householdId: string): Promise<Snapshot> {
    const { target, version } = await this.settings.resolve(householdId);
    const cached = this.snapshots.get(householdId);
    const now = Date.now();
    if (cached && cached.version === version && now - cached.at < STATES_CACHE_MS) return cached.value;
    const value: Promise<Snapshot> = target
      ? fetchHomeAssistantStates(target).then(
          (states): Snapshot => ({ ok: true, states, checkedAt: this.clock.now() }),
          (error): Snapshot => ({ ok: false, configured: true, message: failureMessage(error), checkedAt: this.clock.now() }),
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

  private presentDevice(row: SmartHomeDevice): SmartHomeDeviceView {
    return {
      entityId: row.entityId,
      domain: row.domain as SmartHomeDomain,
      displayName: row.displayName,
      area: row.area,
      sortOrder: row.sortOrder,
      controllable: row.controllable,
      minRole: row.minRole,
      pinnedToToday: row.pinnedToToday,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
