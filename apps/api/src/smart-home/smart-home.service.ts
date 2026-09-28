import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  SMART_HOME_BLOCKED_DOMAINS,
  SMART_HOME_DOMAINS,
  type SmartHomeConnection,
  type SmartHomeDevice as SmartHomeDeviceView,
  type SmartHomeDirectory,
  type SmartHomeDomain,
  type SmartHomeStates,
  type UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { SmartHomeDevice } from '../entities';
import {
  HomeAssistantError,
  fetchHomeAssistantStates,
  friendlyName,
  pingHomeAssistant,
  presentHomeAssistantState,
  type HomeAssistantRawState,
} from './home-assistant.client';
import { SmartHomeSettingsService } from './smart-home-settings.service';

/** 同一家庭几个人同时打开页面时合并成一次 HA 请求；连不上也缓存这么久，免得连点刷新一直等超时。 */
const STATES_CACHE_MS = 2_000;
const PAGE_PATH = '/house/smart-home';

type Snapshot =
  | { ok: true; states: HomeAssistantRawState[]; checkedAt: Date }
  | { ok: false; configured: boolean; message: string; checkedAt: Date };

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
    const [snapshot, rows] = await Promise.all([
      this.snapshot(householdId),
      this.devices.find({ where: { householdId }, select: { entityId: true } }),
    ]);
    const whitelisted = new Set(rows.map((row) => row.entityId));
    const entities = snapshot.ok
      ? snapshot.states
          .filter((raw) => isSupported(domainOf(raw.entity_id)))
          .map((raw) => ({
            entityId: raw.entity_id,
            domain: domainOf(raw.entity_id) as SmartHomeDomain,
            name: friendlyName(raw),
            state: presentHomeAssistantState(raw),
            whitelisted: whitelisted.has(raw.entity_id),
          }))
          .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name, 'zh-CN'))
      : [];
    return { connection: this.connection(snapshot), entities };
  }

  async states(householdId: string): Promise<SmartHomeStates> {
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
        return { ...device, state };
      }),
    };
  }

  async upsert(entityId: string, input: UpsertSmartHomeDeviceBody, user: JwtUser) {
    const domain = domainOf(entityId);
    if ((SMART_HOME_BLOCKED_DOMAINS as readonly string[]).includes(domain)) {
      throw new BadRequestException('门锁和安防不接进小管家');
    }
    if (!isSupported(domain)) {
      throw new BadRequestException('这类实体第一期还不支持');
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
