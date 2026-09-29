import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { smartHomeRulesSchema, DEFAULT_SMART_HOME_RULES, type SmartHomeRules } from '@family/contracts';
import type { Capability } from '../auth/capabilities';
import { SmartHomeDevice, SmartHomeWebhookSettings } from '../entities';
import { TasksService } from '../tasks/tasks.module';
import {
  AttentionRegistry,
  type AttentionCandidate,
  type AttentionRuleContext,
  type AttentionSource,
} from '../today/today-attention.rules';
import { smartHomeActor } from './smart-home-actor';
import { SmartHomeService } from './smart-home.service';

export const SMART_HOME_ATTENTION = {
  /** 洗完 / 烘完这么久「晾衣服」还没打勾 */
  laundryPendingMs: 2 * 3_600_000,
  /** 连不上 HA 这么久才提醒管理员（短暂重启、断网不打扰） */
  offlineMs: 3_600_000,
  /** 今天页不为读滤芯等 HA：超过这么久就当这次读不到，下次再说 */
  stateWaitMs: 1_500,
} as const;

/** 和 E3 联动建的家务同名（smart-home-linkages.service） */
const LAUNDRY_TASK = '晾衣服';

type FilterInput = { rules: SmartHomeRules; device: { id: string; displayName: string } | null; value: number | null };

/**
 * 滤芯低（纯函数，黑盒之外也好推）：E3 规则里「滤芯低」开着、选了触发实体、那台设备还在白名单里，
 * 且实体此刻是数值、低于阈值（与 HA 自动化的 numeric_state below 同义：严格小于）。
 */
export function filterLowCandidate({ rules, device, value }: FilterInput): AttentionCandidate | null {
  if (!rules.filter.enabled || !rules.filter.trigger || !device || value === null) return null;
  if (!(value < rules.filter.threshold)) return null;
  return { domain: 'smart-home', kind: 'filter', id: device.id, name: device.displayName, overdue: false };
}

/**
 * HA 连不上超过一小时（只给管理员）：只看 SmartHomeService 记下的「从什么时候起连不上」，不为这条规则去等 HA。
 * 起点是库里记的最近一次连通（integrations.lastSyncedAt），API 重启不归零；服务器默认的连接没处记，重启后从头计。
 */
export function offlineCandidate(householdId: string, since: Date | null, now: Date): AttentionCandidate | null {
  if (!since || now.getTime() - since.getTime() < SMART_HOME_ATTENTION.offlineMs) return null;
  // entity.id 要是 uuid，连接本身没有自己的 id：用家庭 id，前端只按 kind 找路径
  return { domain: 'smart-home', kind: 'offline', id: householdId, name: 'Home Assistant', overdue: false };
}

/**
 * 智能家居的三条留意规则（pre-trial-plan H3 E5、smart-home-redesign §2.5）：滤芯低、洗烘完成超过 2 小时没人晾、
 * HA 断开超过 1 小时（管理员）。挂到今天页的 AttentionRegistry；合成一张卡由今天页负责（一个域一张卡）。
 */
@Injectable()
export class SmartHomeAttentionSource implements AttentionSource, OnModuleInit {
  readonly domain = 'smart-home' as const;

  constructor(
    private readonly registry: AttentionRegistry,
    private readonly dataSource: DataSource,
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    @InjectRepository(SmartHomeWebhookSettings)
    private readonly webhookSettings: Repository<SmartHomeWebhookSettings>,
    private readonly smartHome: SmartHomeService,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async run(context: AttentionRuleContext, can: (capability: Capability) => boolean): Promise<AttentionCandidate[]> {
    const devices = await this.devices.find({ where: { householdId: context.householdId } });
    // 白名单是空的 = 家里没在用智能家居（家里页也不显示这个分段），三条都不看
    if (!devices.length) return [];
    const [filter, laundry] = await Promise.all([this.filter(context, devices), this.laundry(context)]);
    const offline = can('manage_integrations')
      ? offlineCandidate(context.householdId, await this.smartHome.unreachableSince(context.householdId), context.now)
      : null;
    return [filter, laundry, offline].filter((one): one is AttentionCandidate => one !== null);
  }

  private async filter(context: AttentionRuleContext, devices: SmartHomeDevice[]) {
    const row = await this.webhookSettings.findOne({ where: { householdId: context.householdId } });
    const parsed = smartHomeRulesSchema.safeParse(row?.rules);
    const rules = parsed.success ? parsed.data : DEFAULT_SMART_HOME_RULES;
    const trigger = rules.filter.trigger;
    if (!rules.filter.enabled || !trigger) return null;
    const device = devices.find((one) => one.id === trigger.deviceId) ?? null;
    if (!device) return null;
    const snapshot = await Promise.race([
      this.smartHome.snapshot(context.householdId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SMART_HOME_ATTENTION.stateWaitMs).unref?.()),
    ]);
    const raw = snapshot?.ok ? snapshot.states.find((state) => state.entity_id === trigger.entityId) : undefined;
    const value = raw && raw.state.trim() !== '' && Number.isFinite(Number(raw.state)) ? Number(raw.state) : null;
    return filterLowCandidate({ rules, device, value });
  }

  /** 今天收到过「洗完 / 烘完」、离现在已超过 2 小时，今天的「晾衣服」还没打勾。 */
  private async laundry(context: AttentionRuleContext): Promise<AttentionCandidate | null> {
    const cutoff = new Date(context.now.getTime() - SMART_HOME_ATTENTION.laundryPendingMs);
    const [event]: { receivedAt: Date }[] = await this.dataSource.query(
      `SELECT "receivedAt" FROM smart_home_events
        WHERE "householdId" = $1 AND event = 'laundry_done' AND status = 'processed'
          AND ("receivedAt" AT TIME ZONE $2)::date = $3::date AND "receivedAt" <= $4
        ORDER BY "receivedAt" DESC LIMIT 1`,
      [context.householdId, context.timezone, context.today, cutoff],
    );
    if (!event) return null;
    const actor = await smartHomeActor(this.dataSource, context.householdId);
    if (!actor) return null;
    const occurrences = await this.tasks.list(context.today, context.today, actor);
    const pending = occurrences.find((one) => one.status === 'pending' && one.task.title === LAUNDRY_TASK);
    if (!pending) return null;
    return {
      domain: 'smart-home',
      kind: 'laundry',
      id: pending.taskId,
      name: LAUNDRY_TASK,
      dueOn: context.today,
      overdue: false,
    };
  }
}
