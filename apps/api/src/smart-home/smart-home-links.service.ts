import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  smartHomeActionsFor,
  type CreateSmartHomeLinkBody,
  type SmartHomeAction,
  type SmartHomeLink as SmartHomeLinkView,
  type UpdateSmartHomeLinkBody,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { SmartHomeDevice, SmartHomeLink, SmartHomeLinkRun } from '../entities';
import { EventBus } from '../events/event-bus';
import { TaskEvents, type TaskCompletedEvent } from '../tasks/task-events';
import { isSmartHomeActor, smartHomeActor } from './smart-home-actor';
import { SmartHomeCommandsService } from './smart-home-commands.service';

const SETTINGS_PATH = '/house/smart-home/settings?section=linkages';

function pollMs() {
  const configured = Number(process.env.SMART_HOME_LINKS_POLL_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 30_000;
}

function isUniqueViolation(error: unknown) {
  return error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505';
}

/**
 * E4：小管家 → HA。两个挂点（home-assistant-plan §5.2）：
 * - 家务打勾（TaskEvents，事务提交后异步，打勾本身不等 HA）；
 * - 日程开始前 N 分钟（这里自己的定时器，跟提醒派发互不相干——HA 挂了，日历提醒照常）。
 * 执行走 E2 的控制链路（权限、审计、超时）；(规则, 那一次发生) 唯一，同一次只跑一次；
 * 失败只在家庭动态里记一句。联动自己打的勾不再触发联动（防自激：E3 扫完打勾 → E4 启动扫地机）。
 */
@Injectable()
export class SmartHomeLinksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SmartHomeLinks');
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private polling = false;

  constructor(
    @InjectRepository(SmartHomeLink)
    private readonly links: Repository<SmartHomeLink>,
    @InjectRepository(SmartHomeLinkRun)
    private readonly runs: Repository<SmartHomeLinkRun>,
    @InjectRepository(SmartHomeDevice)
    private readonly devices: Repository<SmartHomeDevice>,
    private readonly dataSource: DataSource,
    private readonly commands: SmartHomeCommandsService,
    private readonly taskEvents: TaskEvents,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.taskEvents.onCompleted((event) => this.onTaskCompleted(event));
    this.timer = setInterval(() => void this.pollCalendar(), pollMs());
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  // ---- 规则 CRUD -------------------------------------------------------------------------------

  async list(householdId: string): Promise<SmartHomeLinkView[]> {
    const rows = await this.links.find({ where: { householdId }, order: { createdAt: 'ASC' } });
    if (!rows.length) return [];
    const lastRuns: { linkId: string; status: SmartHomeLinkRun['status']; message: string | null; createdAt: Date }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ON ("linkId") "linkId", status, message, "createdAt" FROM smart_home_link_runs
         WHERE "householdId" = $1 ORDER BY "linkId", "createdAt" DESC`,
        [householdId],
      );
    const byLink = new Map(lastRuns.map((run) => [run.linkId, run]));
    return rows.map((row) => this.present(row, byLink.get(row.id) ?? null));
  }

  async create(input: CreateSmartHomeLinkBody, user: JwtUser) {
    const row = this.links.create({
      householdId: user.householdId,
      name: input.name,
      trigger: input.trigger,
      keyword: input.keyword,
      offsetMinutes: input.trigger === 'calendar_before' ? input.offsetMinutes ?? 10 : 0,
      targetDeviceId: input.targetDeviceId,
      targetEntityId: '',
      action: input.action,
      enabled: input.enabled ?? true,
      createdById: user.memberId,
    });
    await this.validateTarget(row, user.householdId);
    const saved = await this.links.save(row);
    return this.present(saved, null);
  }

  async update(id: string, input: UpdateSmartHomeLinkBody, user: JwtUser) {
    const row = await this.links.findOne({ where: { id, householdId: user.householdId } });
    if (!row) throw new NotFoundException('联动不存在');
    Object.assign(row, input);
    if (row.trigger === 'task_done') row.offsetMinutes = 0;
    // 目标设备不在了的旧联动只能停用或删掉：只关开关时不校验目标
    if (row.enabled || input.targetDeviceId !== undefined || input.action !== undefined) {
      await this.validateTarget(row, user.householdId);
    }
    const saved = await this.links.save(row);
    return (await this.list(user.householdId)).find((link) => link.id === saved.id)!;
  }

  async remove(id: string, user: JwtUser) {
    const result = await this.links.delete({ id, householdId: user.householdId });
    if (!result.affected) throw new NotFoundException('联动不存在');
    return { id };
  }

  /** 目标必须是白名单里开放了控制的设备，动作它的主实体有。执行时 E2 还会再校验一遍。 */
  private async validateTarget(row: SmartHomeLink, householdId: string) {
    const device = row.targetDeviceId
      ? await this.devices.findOne({ where: { householdId, id: row.targetDeviceId } })
      : null;
    if (!device) throw new BadRequestException('目标设备不在白名单里');
    if (!device.controllable) throw new BadRequestException('目标设备还没开放控制，先在白名单里勾上「允许控制」');
    if (!smartHomeActionsFor(device.primaryDomain).includes(row.action as SmartHomeAction)) {
      throw new BadRequestException('这台设备没有这个动作');
    }
    row.targetEntityId = device.primaryEntityId;
  }

  // ---- 触发 ------------------------------------------------------------------------------------

  async onTaskCompleted(event: TaskCompletedEvent) {
    if (isSmartHomeActor(event.actor)) return;
    const matched = await this.links
      .createQueryBuilder('link')
      .where('link.householdId = :householdId', { householdId: event.householdId })
      .andWhere('link.enabled = true')
      .andWhere("link.trigger = 'task_done'")
      .andWhere(":title ILIKE '%' || replace(replace(replace(link.keyword, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'", {
        title: event.title,
      })
      .getMany();
    for (const link of matched) await this.run(link, `task:${event.taskId}:${event.dueDate}`, `「${event.title}」打勾了`);
  }

  /** 到点的日程：有开始时间、还没开始、已进入「开始前 N 分钟」。事件改期后键跟着变，按新时间再跑一次。 */
  async pollCalendar() {
    if (this.polling) return;
    this.polling = true;
    try {
      const due: { linkId: string; eventId: string; startsAt: Date; title: string }[] = await this.dataSource.query(
        `SELECT l.id AS "linkId", e.id AS "eventId", e."startsAt", e.title
         FROM smart_home_links l
         JOIN calendar_events e ON e."householdId" = l."householdId"
         WHERE l.enabled AND l.trigger = 'calendar_before'
           AND e."startsAt" IS NOT NULL
           AND e."startsAt" > now()
           AND e."startsAt" - make_interval(mins => l."offsetMinutes") <= now()
           AND e.title ILIKE '%' || replace(replace(replace(l.keyword, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
           AND NOT EXISTS (
             SELECT 1 FROM smart_home_link_runs r
             WHERE r."linkId" = l.id AND r."occurrenceKey" = 'calendar:' || e.id || ':' || to_char(e."startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           )`,
      );
      for (const row of due) {
        const link = await this.links.findOne({ where: { id: row.linkId } });
        if (!link) continue;
        const key = `calendar:${row.eventId}:${new Date(row.startsAt).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
        await this.run(link, key, `日程「${row.title}」快开始了`);
      }
    } catch (error) {
      this.logger.warn(`smart_home_links_poll_failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.polling = false;
    }
  }

  // ---- 执行 ------------------------------------------------------------------------------------

  private async run(link: SmartHomeLink, occurrenceKey: string, reason: string) {
    let record: SmartHomeLinkRun;
    try {
      record = await this.runs.save(
        this.runs.create({ householdId: link.householdId, linkId: link.id, occurrenceKey, status: 'pending', message: null }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return; // 这一次已经跑过（或正在跑）
      throw error;
    }
    const actor = await smartHomeActor(this.dataSource, link.householdId);
    try {
      if (!actor) throw new Error('家里没有在用的家庭主人');
      if (!link.targetDeviceId) throw new Error('目标设备已经不在白名单里了');
      const result = await this.commands.execute(
        link.targetDeviceId,
        { action: link.action as SmartHomeAction, requestId: record.id },
        actor,
      );
      record.status = 'succeeded';
      record.message = `${reason}：${result.message ?? '已执行'}`.slice(0, 300);
    } catch (error) {
      record.status = 'failed';
      const message =
        error instanceof HttpException || error instanceof Error ? error.message : '执行失败';
      record.message = `${reason}：${message}`.slice(0, 300);
      if (actor) {
        await recordActivity(this.dataSource.manager, actor, {
          module: 'system',
          action: 'smart_home_link_failed',
          summary: `联动「${link.name}」没执行成功`,
          detail: record.message,
          targetPath: SETTINGS_PATH,
          metadata: { linkId: link.id, occurrenceKey },
        }).catch(() => undefined);
      }
    }
    record.finishedAt = new Date();
    await this.runs.save(record);
    // 联动不经过 HTTP 拦截器：自己告诉家里人智能家居和动态有变化
    this.bus.publish({ householdId: link.householdId, domains: ['smart-home', 'activity'] });
  }

  private present(
    row: SmartHomeLink,
    lastRun: { status: SmartHomeLinkRun['status']; message: string | null; createdAt: Date } | null,
  ): SmartHomeLinkView {
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      keyword: row.keyword,
      offsetMinutes: row.offsetMinutes,
      targetDeviceId: row.targetDeviceId,
      targetEntityId: row.targetEntityId,
      action: row.action as SmartHomeAction,
      enabled: row.enabled,
      lastRun: lastRun
        ? { status: lastRun.status, message: lastRun.message, at: new Date(lastRun.createdAt).toISOString() }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
