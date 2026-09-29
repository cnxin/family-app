import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  SMART_HOME_BLOCKED_DOMAINS,
  SMART_HOME_DOMAINS,
  SMART_HOME_FEATURED_LIMIT,
  isExcludedSmartHomeEntity,
  smartHomeActionsFor,
  smartHomeRulesSchema,
  type AddSmartHomeDeviceBody,
  type SmartHomeDevice as SmartHomeDeviceView,
  type UpdateSmartHomeDeviceBody,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { SmartHomeDevice, SmartHomeLink, SmartHomeWebhookSettings } from '../entities';
import { friendlyName } from './home-assistant.client';
import { domainOf, entitiesOfDevice, haDeviceName, iconFor, pickDefaults } from './smart-home-devices';
import { hasControllable } from './smart-home-panel.service';
import { SmartHomeService, isReadonlyCover, presentSmartHomeDevice } from './smart-home.service';

const PAGE_PATH = '/house/smart-home';
const cut = (text: string, max: number) => [...text].slice(0, max).join('');
const isSupported = (domain: string) => (SMART_HOME_DOMAINS as readonly string[]).includes(domain);

/**
 * 白名单的增、改、删（smart-home-redesign §4.1）：整台 HA 设备「加进来」时按默认规则算主实体、主面板项、图标、名字、房间；
 * 改主实体 / 主面板项 / 藏掉的子实体时校验它们属于这台设备；移出前查联动和规则有没有在用（不级联删除）。
 */
@Injectable()
export class SmartHomeWhitelistService {
  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    private readonly smartHome: SmartHomeService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 目录里「加进来」（redesign §4.1）：整台 HA 设备按默认规则算主实体、主面板项、图标、名字、房间；
   * 或一个没有归属设备的实体（场景、脚本、helper）成为单实体设备。
   */
  async add(input: AddSmartHomeDeviceBody, user: JwtUser): Promise<SmartHomeDeviceView> {
    const householdId = user.householdId;
    const draft = input.haDeviceId
      ? await this.draftFromDevice(householdId, input.haDeviceId)
      : await this.draftFromEntity(householdId, input.entityId as string);
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SmartHomeDevice);
      const taken = await repository.findOne({ where: { householdId, primaryEntityId: draft.primaryEntityId } });
      if (taken) {
        throw new ConflictException(
          taken.mergeState === 'legacy'
            ? '这台设备还有按实体登记的旧记录没整理完，等连上 Home Assistant 自动整理后再加'
            : '这个已经在白名单里了',
        );
      }
      if (draft.haDeviceId && (await repository.findOne({ where: { householdId, haDeviceId: draft.haDeviceId } }))) {
        throw new ConflictException('这台设备已经在白名单里了');
      }
      const row = repository.create({
        householdId,
        ...draft,
        mergeState: 'ok',
        sortOrder: await repository.count({ where: { householdId } }),
      });
      const result = await repository.save(row);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_device_added',
        summary: `把「${result.displayName}」加进了智能家居`,
        targetPath: PAGE_PATH,
        metadata: { deviceId: result.id, haDeviceId: result.haDeviceId, entityId: result.primaryEntityId },
      });
      return result;
    });
    return presentSmartHomeDevice(saved);
  }

  private async draftFromDevice(householdId: string, haDeviceId: string) {
    const [registries, snapshot] = await Promise.all([this.smartHome.registries(householdId, { fresh: true }), this.smartHome.snapshot(householdId)]);
    if (!registries.ok) throw new BadRequestException(`读不到 Home Assistant 的设备信息：${registries.message}`);
    const device = registries.value.devices.find((one) => one.id === haDeviceId);
    if (!device || device.disabled_by || device.entry_type === 'service') {
      throw new BadRequestException('Home Assistant 里没有这台设备');
    }
    const statesById = new Map(snapshot.ok ? snapshot.states.map((raw) => [raw.entity_id, raw]) : []);
    const name = haDeviceName(device);
    const defaults = pickDefaults(entitiesOfDevice(haDeviceId, registries.value, statesById), name, device.model ?? null);
    if (!defaults.primary) throw new BadRequestException('这台设备没有小管家认得的实体');
    const area = device.area_id ? registries.value.areas.find((one) => one.area_id === device.area_id)?.name ?? null : null;
    return {
      haDeviceId,
      primaryEntityId: defaults.primary.entityId,
      primaryDomain: defaults.primary.domain,
      displayName: cut(name ?? defaults.primary.fullName, 40),
      area: area ? cut(area, 20) : null,
      icon: defaults.icon,
      featuredEntityIds: defaults.featured,
      hiddenEntityIds: [] as string[],
      knownEntityIds: entitiesOfDevice(haDeviceId, registries.value, statesById, { supportedOnly: false }).map(
        (entity) => entity.entityId,
      ),
    };
  }

  private async draftFromEntity(householdId: string, entityId: string) {
    const domain = domainOf(entityId);
    if ((SMART_HOME_BLOCKED_DOMAINS as readonly string[]).includes(domain)) {
      throw new BadRequestException('门锁和安防不接进小管家');
    }
    if (!isSupported(domain)) throw new BadRequestException('这类实体第一期还不支持');
    const [registries, snapshot] = await Promise.all([this.smartHome.registries(householdId, { fresh: true }), this.smartHome.snapshot(householdId)]);
    const entry = registries.ok ? registries.value.entities.find((one) => one.entity_id === entityId) : undefined;
    if (entry?.device_id) throw new BadRequestException('这个实体属于一台设备，请把整台设备加进来');
    const raw = snapshot.ok ? snapshot.states.find((one) => one.entity_id === entityId) : undefined;
    if (snapshot.ok && !raw) throw new BadRequestException('Home Assistant 里没有这个实体');
    const name = raw ? friendlyName(raw) : entityId;
    return {
      haDeviceId: null,
      primaryEntityId: entityId,
      primaryDomain: domain,
      displayName: cut(name, 40),
      area: null,
      icon: iconFor(domain, name),
      featuredEntityIds: [] as string[],
      hiddenEntityIds: [] as string[],
      knownEntityIds: [entityId],
    };
  }

  async update(id: string, input: UpdateSmartHomeDeviceBody, user: JwtUser): Promise<SmartHomeDeviceView> {
    const row = await this.smartHome.find(user.householdId, id);
    if (!row) throw new NotFoundException('白名单里没有这台设备');
    const allowed = await this.smartHome.entitiesOf(row);
    const belongs = (entityId: string) => allowed.has(entityId);

    if (input.primaryEntityId !== undefined && input.primaryEntityId !== row.primaryEntityId) {
      const domain = domainOf(input.primaryEntityId);
      if (!row.haDeviceId) throw new BadRequestException('单实体设备不能换主实体');
      if (!belongs(input.primaryEntityId)) throw new BadRequestException('主实体必须是这台设备的实体');
      if (!isSupported(domain)) throw new BadRequestException('这类实体第一期还不支持');
      if (isExcludedSmartHomeEntity(domain, null, [input.primaryEntityId])) {
        throw new BadRequestException('复位、重启这类操作不能当主实体');
      }
      const taken = await this.devices.findOne({ where: { householdId: user.householdId, primaryEntityId: input.primaryEntityId } });
      if (taken && taken.id !== row.id) throw new ConflictException('这个实体已经是另一台设备的主实体');
      row.primaryEntityId = input.primaryEntityId;
      row.primaryDomain = domain;
    }
    if (input.featuredEntityIds !== undefined) {
      const unique = [...new Set(input.featuredEntityIds)];
      if (unique.length > SMART_HOME_FEATURED_LIMIT) throw new BadRequestException(`主面板项最多 ${SMART_HOME_FEATURED_LIMIT} 个`);
      if (!row.haDeviceId && unique.length) throw new BadRequestException('单实体设备没有主面板项');
      if (!unique.every(belongs)) throw new BadRequestException('主面板项必须是这台设备的实体');
      row.featuredEntityIds = unique;
    }
    if (input.acceptEntityIds !== undefined) {
      // 「N 个新实体待确认」：放出来 = 记进 knownEntityIds（拍板 7）
      const accepted = [...new Set(input.acceptEntityIds)];
      if (!accepted.every(belongs)) throw new BadRequestException('只能确认这台设备自己的实体');
      row.knownEntityIds = [...new Set([...(row.knownEntityIds ?? []), ...accepted])];
    }
    if (input.hiddenEntityIds !== undefined) {
      const unique = [...new Set(input.hiddenEntityIds)];
      if (!unique.every(belongs)) throw new BadRequestException('只能藏这台设备自己的实体');
      row.hiddenEntityIds = unique;
    }
    // 主实体不能同时是主面板项、也不能被藏掉
    row.featuredEntityIds = (row.featuredEntityIds ?? []).filter((entityId) => entityId !== row.primaryEntityId);
    if ((row.hiddenEntityIds ?? []).includes(row.primaryEntityId)) throw new BadRequestException('主实体不能藏');

    if (input.displayName !== undefined) row.displayName = input.displayName;
    if (input.area !== undefined) row.area = input.area?.trim() || null;
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    if (input.icon !== undefined) row.icon = input.icon;
    if (input.minRole !== undefined) row.minRole = input.minRole;
    if (input.pinnedToToday !== undefined) row.pinnedToToday = input.pinnedToToday;
    if (input.controllable !== undefined) row.controllable = input.controllable;
    if (row.controllable) {
      const controllable =
        smartHomeActionsFor(row.primaryDomain).length > 0 ||
        hasControllable(row, await this.smartHome.deviceContext(row));
      if (!controllable) {
        if (input.controllable) throw new BadRequestException('这台设备只能看，不能在小管家里控制');
        // 换了个不能控的主实体、也没有能控的子实体：控制跟着关掉
        row.controllable = false;
      } else if (smartHomeActionsFor(row.primaryDomain).length) {
        const state = await this.smartHome.currentState(user.householdId, row.primaryEntityId);
        if (isReadonlyCover(row.primaryDomain, state?.deviceClass ?? null)) {
          throw new BadRequestException('车库门、大门这类只读，不能在小管家里控制');
        }
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(SmartHomeDevice).save(row);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_device_updated',
        summary: `改了智能家居设备「${result.displayName}」`,
        targetPath: PAGE_PATH,
        metadata: { deviceId: result.id },
      });
      return result;
    });
    return presentSmartHomeDevice(saved);
  }

  async remove(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SmartHomeDevice);
      const existing = await repository.findOne({ where: { householdId: user.householdId, id } });
      if (!existing) throw new NotFoundException('白名单里没有这台设备');
      const users = await this.referencesTo(manager.getRepository(SmartHomeLink), manager.getRepository(SmartHomeWebhookSettings), existing);
      if (users.length) {
        throw new ConflictException(`还有 ${users.join('、')} 在用这台设备，先改掉再移出`);
      }
      await repository.delete(existing.id);
      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_device_removed',
        summary: `把「${existing.displayName}」移出了智能家居`,
        targetPath: PAGE_PATH,
        metadata: { deviceId: existing.id, entityId: existing.primaryEntityId },
      });
    });
    return { id };
  }

  /** 谁在引用这台设备：E4 联动、E3 三条规则。移出前要先改掉（不做级联删除，免得联动悄悄失效）。 */
  private async referencesTo(
    links: Repository<SmartHomeLink>,
    settings: Repository<SmartHomeWebhookSettings>,
    device: SmartHomeDevice,
  ) {
    const found: string[] = [];
    const linked = await links.find({ where: { householdId: device.householdId, targetDeviceId: device.id } });
    for (const link of linked) found.push(`联动「${link.name}」`);
    const row = await settings.findOne({ where: { householdId: device.householdId } });
    const parsed = smartHomeRulesSchema.safeParse(row?.rules);
    if (parsed.success) {
      const rules = parsed.data;
      if (rules.laundry.washer?.deviceId === device.id) found.push('规则「洗衣机洗完」');
      if (rules.laundry.dryer?.deviceId === device.id) found.push('规则「烘干机烘完」');
      if (rules.vacuum.trigger?.deviceId === device.id) found.push('规则「扫地机扫完」');
      if (rules.filter.trigger?.deviceId === device.id) found.push('规则「滤芯快到期」');
    }
    return found;
  }
}
