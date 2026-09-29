import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SMART_HOME_DOMAINS,
  isExcludedSmartHomeEntity,
  type SmartHomeCommand,
  type SmartHomeControl,
  type SmartHomeHistory,
  type SmartHomePanel,
  type SmartHomePanelEntity,
} from '@family/contracts';
import { JwtUser } from '../auth/jwt.guard';
import { SmartHomeCommandRecord, SmartHomeDevice, type MemberRole } from '../entities';
import { fetchHomeAssistantHistory, friendlyName, type HomeAssistantRawState } from './home-assistant.client';
import type { HomeAssistantEntityRegistryEntry } from './home-assistant.ws';
import { describeEntity } from './smart-home-controls';
import { domainOf, stripDeviceName } from './smart-home-devices';
import { SmartHomeService, presentSmartHomeDevice } from './smart-home.service';
import { SmartHomeSettingsService } from './smart-home-settings.service';

type DeviceContext = Awaited<ReturnType<SmartHomeService['deviceContext']>>;

/** 「更多设置」里能出控件的类型（§9.4）；主实体另算。 */
const CONTROL_DOMAINS = ['select', 'number', 'switch', 'input_boolean', 'button', 'light', 'fan'];
const HISTORY_CACHE_MS = 5 * 60_000;
const HISTORY_POINTS = 48;

/** 设备开放了控制、角色也够：这个人能控这台设备。 */
export function canOperate(device: Pick<SmartHomeDevice, 'controllable' | 'minRole'>, role: MemberRole) {
  return device.controllable && (device.minRole === 'member' || role === 'owner' || role === 'admin');
}

/** 一个子实体在这台设备上的身份：没有 / 藏掉 / 待确认 / 排除 / 诊断 / 可以用。命令接口和面板共用。 */
export type EntityAccess =
  | { kind: 'missing' }
  | { kind: 'pending' }
  | { kind: 'excluded'; name: string }
  | { kind: 'ok'; name: string; raw: HomeAssistantRawState | undefined; registry: HomeAssistantEntityRegistryEntry | undefined; diagnostic: boolean };

export function entityAccess(row: SmartHomeDevice, context: DeviceContext, entityId: string): EntityAccess {
  const isPrimary = entityId === row.primaryEntityId;
  if (!context.ids.includes(entityId) || (!isPrimary && (row.hiddenEntityIds ?? []).includes(entityId))) return { kind: 'missing' };
  const domain = domainOf(entityId);
  if (!(SMART_HOME_DOMAINS as readonly string[]).includes(domain)) return { kind: 'missing' };
  const known = isPrimary || (row.featuredEntityIds ?? []).includes(entityId) || (row.knownEntityIds ?? []).includes(entityId);
  if (!known) return { kind: 'pending' };
  const raw = context.byId?.get(entityId);
  const fullName = raw ? friendlyName(raw) : entityId;
  const name = stripDeviceName(fullName, context.deviceName ?? row.displayName);
  const deviceClass = typeof raw?.attributes?.device_class === 'string' ? raw.attributes.device_class : null;
  if (!isPrimary && isExcludedSmartHomeEntity(domain, deviceClass, [name, fullName])) return { kind: 'excluded', name };
  const registry = context.entries.get(entityId);
  return { kind: 'ok', name, raw, registry, diagnostic: registry?.entity_category === 'diagnostic' };
}

/** 这个人此刻对这个实体能出什么控件（null = 只读）。HA 连不上时一律只读。 */
export function controlFor(
  row: SmartHomeDevice,
  context: DeviceContext,
  entityId: string,
  access: Extract<EntityAccess, { kind: 'ok' }>,
  operator: boolean,
): SmartHomeControl | null {
  if (!operator || !context.live || access.diagnostic) return null;
  const domain = domainOf(entityId);
  if (entityId !== row.primaryEntityId && !CONTROL_DOMAINS.includes(domain) && !(row.featuredEntityIds ?? []).includes(entityId)) {
    return null;
  }
  return describeEntity(domain, {
    raw: access.raw,
    registry: access.registry,
    translations: context.translations,
    areaNames: context.areaNames,
  });
}

/**
 * 这台设备有没有能控的东西：主实体本身有动作，或者名下有可控的子实体（比如海尔洗衣机的启停按钮）。
 * 「允许控制」只在有的时候才能打开。HA 连不上时只看主实体。
 */
export function hasControllable(row: SmartHomeDevice, context: DeviceContext) {
  return context.ids.some((entityId) => {
    const access = entityAccess(row, context, entityId);
    return access.kind === 'ok' && controlFor(row, context, entityId, access, true) !== null;
  });
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-CN');

/**
 * 详情面板（smart-home-redesign §9）：主实体、主面板项按原样，其余子实体按规则归位——
 * 能控的进「更多设置」（没权限的人看不到这一段），排除名单进 excluded，diagnostic 与其余只读进「设备信息」，
 * HA 新冒出来还没确认的只给管理员看（拍板 7）。另附这台设备最近 3 条操作、24 小时趋势。
 */
@Injectable()
export class SmartHomePanelService {
  private readonly historyCache = new Map<string, { at: number; value: SmartHomeHistory }>();

  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    @InjectRepository(SmartHomeCommandRecord)
    private readonly commands: Repository<SmartHomeCommandRecord>,
    private readonly smartHome: SmartHomeService,
    private readonly settings: SmartHomeSettingsService,
  ) {}

  async panel(id: string, user: JwtUser): Promise<SmartHomePanel> {
    const row = await this.devices.findOne({ where: { householdId: user.householdId, id } });
    if (!row) throw new NotFoundException('白名单里没有这台设备');
    const context = await this.smartHome.deviceContext(row);
    const manager = user.role === 'owner' || user.role === 'admin';
    const operator = canOperate(row, user.role);

    const present = (entityId: string, access: Extract<EntityAccess, { kind: 'ok' }>): SmartHomePanelEntity => ({
      entityId,
      domain: domainOf(entityId),
      name: access.name,
      category: access.registry?.entity_category ?? null,
      state: this.smartHome.presentState(context.byId, entityId),
      control: controlFor(row, context, entityId, access, operator),
    });
    const primaryAccess = entityAccess(row, context, row.primaryEntityId);
    const primary =
      primaryAccess.kind === 'ok'
        ? present(row.primaryEntityId, primaryAccess)
        : { entityId: row.primaryEntityId, domain: row.primaryDomain, name: row.displayName, category: null, state: null, control: null };

    const featured: SmartHomePanelEntity[] = [];
    for (const entityId of row.featuredEntityIds ?? []) {
      const access = entityAccess(row, context, entityId);
      if (access.kind === 'ok') featured.push(present(entityId, access));
    }

    const more: SmartHomePanelEntity[] = [];
    const info: SmartHomePanelEntity[] = [];
    const excluded: SmartHomePanel['excluded'] = [];
    const pending: SmartHomePanel['pending'] = [];
    const shown = new Set([row.primaryEntityId, ...(row.featuredEntityIds ?? [])]);
    for (const entityId of context.ids) {
      if (shown.has(entityId)) continue;
      const access = entityAccess(row, context, entityId);
      if (access.kind === 'missing') continue;
      if (access.kind === 'pending') {
        const raw = context.byId?.get(entityId);
        pending.push({
          entityId,
          name: stripDeviceName(raw ? friendlyName(raw) : entityId, context.deviceName ?? row.displayName),
          domain: domainOf(entityId),
        });
        continue;
      }
      if (access.kind === 'excluded') {
        excluded.push({ entityId, name: access.name });
        continue;
      }
      const entity = present(entityId, access);
      if (!access.diagnostic && CONTROL_DOMAINS.includes(entity.domain)) {
        // 没权限的人不出「更多设置」（§9.8）
        if (operator) more.push(entity);
      } else {
        info.push(entity);
      }
    }

    const catalog = manager
      ? context.ids
          .filter((entityId) => (SMART_HOME_DOMAINS as readonly string[]).includes(domainOf(entityId)))
          .map((entityId) => {
            const raw = context.byId?.get(entityId);
            return {
              entityId,
              name: stripDeviceName(raw ? friendlyName(raw) : entityId, context.deviceName ?? row.displayName),
              domain: domainOf(entityId),
              category: context.entries.get(entityId)?.entity_category ?? null,
              hidden: (row.hiddenEntityIds ?? []).includes(entityId),
            };
          })
          .sort(byName)
      : [];

    return {
      device: presentSmartHomeDevice(row),
      connection: context.connection,
      stale: context.stale,
      asOf: context.asOf,
      online: Boolean(primary.state && primary.state.state !== 'unavailable'),
      canControl: operator && context.live,
      manufacturer: context.device?.manufacturer ?? null,
      model: context.device?.model ?? null,
      primary,
      featured,
      more: more.sort(byName),
      info: info.sort(byName),
      excluded: excluded.sort(byName),
      pending: manager ? pending.sort(byName) : [],
      catalog,
      recent: await this.recent(row),
    };
  }

  /** 这台设备最近 3 条操作（全家可见，拍板 3）：只露成员名、动作、时间、成败。 */
  private async recent(row: SmartHomeDevice): Promise<SmartHomeCommand[]> {
    const rows = await this.commands.find({
      where: { householdId: row.householdId, deviceId: row.id },
      relations: { member: true },
      order: { createdAt: 'DESC' },
      take: 3,
    });
    return rows.map((one) => ({
      id: one.id,
      deviceId: one.deviceId,
      entityId: one.entityId,
      action: one.action as SmartHomeCommand['action'],
      status: one.status,
      message: one.status === 'failed' ? one.message : null,
      memberName: one.member?.name ?? '',
      createdAt: one.createdAt.toISOString(),
      finishedAt: one.finishedAt?.toISOString() ?? null,
      replayed: false,
    }));
  }

  /** 某个数值子实体最近 24 小时，降采样到 ≤ 48 点（每半小时取最后一个值），缓存 5 分钟；取不到就空。 */
  async history(id: string, entityId: string, user: JwtUser): Promise<SmartHomeHistory> {
    const row = await this.devices.findOne({ where: { householdId: user.householdId, id } });
    if (!row) throw new NotFoundException('白名单里没有这台设备');
    const context = await this.smartHome.deviceContext(row);
    const access = entityAccess(row, context, entityId);
    if (access.kind !== 'ok') throw new NotFoundException('这台设备没有这个实体');
    const unit = typeof access.raw?.attributes?.unit_of_measurement === 'string' ? access.raw.attributes.unit_of_measurement : null;
    const empty = { entityId, unit, points: [] };
    const key = `${user.householdId}:${entityId}`;
    const cached = this.historyCache.get(key);
    if (cached && Date.now() - cached.at < HISTORY_CACHE_MS) return cached.value;
    const { target } = await this.settings.resolve(user.householdId);
    if (!target) return empty;
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3_600_000);
    const raw = await fetchHomeAssistantHistory(target, entityId, start, end).catch(() => null);
    if (!raw) return empty;
    const bucketMs = (24 * 3_600_000) / HISTORY_POINTS;
    const buckets = new Map<number, { at: Date; value: number }>();
    for (const point of raw) {
      const index = Math.min(HISTORY_POINTS - 1, Math.max(0, Math.floor((point.at.getTime() - start.getTime()) / bucketMs)));
      buckets.set(index, point);
    }
    const value: SmartHomeHistory = {
      entityId,
      unit,
      points: [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, point]) => ({ at: point.at.toISOString(), value: point.value })),
    };
    this.historyCache.set(key, { at: Date.now(), value });
    return value;
  }
}
