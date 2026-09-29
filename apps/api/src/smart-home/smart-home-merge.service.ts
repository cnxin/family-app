import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager, Repository } from 'typeorm';
import { smartHomeRulesSchema, type SmartHomeEntityRef, type SmartHomeMergeReport } from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { Clock } from '../common/clock';
import {
  SmartHomeCommandRecord,
  SmartHomeDevice,
  SmartHomeLink,
  SmartHomeMergeReportRecord,
  SmartHomeWebhookSettings,
} from '../entities';
import { EventBus } from '../events/event-bus';
import { smartHomeActor } from './smart-home-actor';
import { mergeReport, planMerge, type LegacyRow, type MergePlan } from './smart-home-devices';
import { SmartHomeService } from './smart-home.service';

const PAGE_PATH = '/house/smart-home';

function legacyRow(row: SmartHomeDevice): LegacyRow {
  return {
    id: row.id,
    primaryEntityId: row.primaryEntityId,
    primaryDomain: row.primaryDomain,
    displayName: row.displayName,
    area: row.area,
    controllable: row.controllable,
    minRole: row.minRole,
    pinnedToToday: row.pinnedToToday,
    sortOrder: row.sortOrder,
  };
}

/**
 * 「按实体 → 按设备」归并（smart-home-redesign §5.1 ②、§5.2）。R1 的迁移把旧行原样标成 legacy；
 * 某家庭有 legacy 行、且 HA 的注册表读得到时，这里在一个事务里归并完，幂等（没有 legacy 行就什么都不做）。
 * 连不上 HA 就等下次（SmartHomeLiveService 每分钟对账时会再来）；期间旧行各自作为单实体设备照常显示和控制。
 */
@Injectable()
export class SmartHomeMergeService {
  private readonly logger = new Logger('SmartHomeMerge');
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    private readonly smartHome: SmartHomeService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly bus: EventBus,
  ) {}

  /** 有 legacy 行才动手；返回这次的报告（没做为 null）。 */
  async mergeIfNeeded(householdId: string): Promise<SmartHomeMergeReport | null> {
    if (this.running.has(householdId)) return null;
    this.running.add(householdId);
    try {
      const legacy = await this.devices.find({ where: { householdId, mergeState: 'legacy' } });
      if (!legacy.length) return null;
      const registries = await this.smartHome.registries(householdId, { fresh: true });
      if (!registries.ok) return null;
      const snapshot = await this.smartHome.snapshot(householdId);
      const statesById = new Map(snapshot.ok ? snapshot.states.map((raw) => [raw.entity_id, raw]) : []);
      const existing = (await this.devices.find({ where: { householdId, mergeState: 'ok' } })).map((row) => ({
        id: row.id,
        haDeviceId: row.haDeviceId,
        primaryEntityId: row.primaryEntityId,
        featuredEntityIds: row.featuredEntityIds ?? [],
      }));
      const rows = legacy.map(legacyRow);
      const plan = planMerge(rows, registries.value, statesById, existing);
      const report = await this.dataSource.transaction((manager) => this.apply(manager, householdId, plan, rows));
      this.bus.publish({ householdId, domains: ['smart-home', 'activity'] });
      this.logger.log(
        `smart_home_merged household=${householdId} rows=${rows.length} devices=${report.devices.length}`,
      );
      return report;
    } catch (error) {
      this.logger.warn(`smart_home_merge_failed household=${householdId} ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      this.running.delete(householdId);
    }
  }

  private async apply(manager: EntityManager, householdId: string, plan: MergePlan, rows: LegacyRow[]) {
    const devices = manager.getRepository(SmartHomeDevice);
    const references: string[] = [];
    const deviceIds = new Map<string, string>();
    /** 被并掉的行 → 并进的那一行 */
    const moved = new Map<string, string>();

    for (const group of plan.groups) {
      const targetId = group.intoExistingId ?? (group.keepRowId as string);
      deviceIds.set(group.haDeviceId, targetId);
      for (const rowId of group.removeRowIds) moved.set(rowId, targetId);
    }

    // 先改引用，再删被并掉的行（联动的外键是 RESTRICT）
    if (moved.size) {
      const links = await manager.getRepository(SmartHomeLink).find({
        where: { householdId, targetDeviceId: In([...moved.keys()]) },
      });
      for (const link of links) {
        const to = moved.get(link.targetDeviceId as string) as string;
        link.targetDeviceId = to;
        await manager.getRepository(SmartHomeLink).save(link);
        references.push(`联动「${link.name}」→ 并到设备 ${to}（目标实体仍记 ${link.targetEntityId}，执行时按设备的主实体）`);
      }
      for (const [from, to] of moved) {
        const result = await manager
          .getRepository(SmartHomeCommandRecord)
          .update({ householdId, deviceId: from }, { deviceId: to });
        if (result.affected) references.push(`审计 ${result.affected} 条 → 设备 ${to}`);
      }
      const settings = await manager.getRepository(SmartHomeWebhookSettings).findOne({ where: { householdId } });
      const parsed = smartHomeRulesSchema.safeParse(settings?.rules);
      if (settings && parsed.success) {
        const rules = parsed.data;
        const remap = (label: string, ref: SmartHomeEntityRef | null) => {
          if (!ref || !moved.has(ref.deviceId)) return ref;
          const to = moved.get(ref.deviceId) as string;
          references.push(`规则「${label}」→ 设备 ${to}（实体 ${ref.entityId}）`);
          return { ...ref, deviceId: to };
        };
        rules.laundry.washer = remap('洗衣机洗完', rules.laundry.washer);
        rules.laundry.dryer = remap('烘干机烘完', rules.laundry.dryer);
        rules.vacuum.trigger = remap('扫地机扫完', rules.vacuum.trigger);
        rules.filter.trigger = remap('滤芯快到期', rules.filter.trigger);
        settings.rules = rules;
        await manager.getRepository(SmartHomeWebhookSettings).save(settings);
      }
    }

    for (const group of plan.groups) {
      const toDelete = group.removeRowIds;
      if (toDelete.length) await devices.delete({ householdId, id: In(toDelete) });
      if (group.intoExistingId) {
        const target = await devices.findOneOrFail({ where: { id: group.intoExistingId } });
        target.featuredEntityIds = group.featuredEntityIds;
        target.knownEntityIds = [...new Set([...(target.knownEntityIds ?? []), ...group.knownEntityIds])];
        await devices.save(target);
        continue;
      }
      const keep = await devices.findOneOrFail({ where: { id: group.keepRowId as string } });
      Object.assign(keep, {
        haDeviceId: group.haDeviceId,
        featuredEntityIds: group.featuredEntityIds,
        knownEntityIds: group.knownEntityIds,
        icon: group.icon,
        area: group.area,
        pinnedToToday: group.pinnedToToday,
        sortOrder: group.sortOrder,
        mergeState: 'ok' as const,
      });
      await devices.save(keep);
    }
    if (plan.singles.length) {
      await devices.update({ householdId, id: In(plan.singles.map((row) => row.id)) }, { mergeState: 'ok' });
    }

    const report = mergeReport(plan, rows, { dryRun: false, mergedAt: this.clock.now(), references, deviceIds });
    await manager.getRepository(SmartHomeMergeReportRecord).save({ householdId, report: report as unknown as Record<string, unknown> });
    const actor = await smartHomeActor(manager.connection, householdId);
    if (actor) {
      await recordActivity(manager, actor, {
        module: 'system',
        action: 'smart_home_devices_merged',
        summary: `智能家居白名单按设备整理：${rows.length} 项 → ${report.devices.length} 台`,
        targetPath: PAGE_PATH,
        metadata: { flagged: report.devices.filter((device) => device.sensorPrimaryWithControllable).length },
      });
    }
    return report;
  }
}
