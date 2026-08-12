import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { CalendarService } from '../calendar/calendar.module';
import {
  AgentRoutine,
  AgentRoutineItem,
  AgentRoutineKind,
  AgentSetting,
  Member,
  Notification,
} from '../entities';
import { InventoryService } from '../inventory/inventory.module';
import { ShoppingService } from '../shopping/shopping.module';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const DAY_MS = 86_400_000;
const DEFAULT_NIGHTLY_HOUR = 21;
const DEFAULT_WEEKLY_HOUR = 20;
const DEFAULT_SCHEDULE_MINUTE = 0;
const SUNDAY = 0;
const ROUTINE_KINDS: AgentRoutineKind[] = [
  'nightly_digest',
  'weekly_report',
];

export interface UpdateAgentRoutineInput {
  enabled?: boolean;
  scheduleHour?: number;
  scheduleMinute?: number;
  nextRunAt?: string;
  expectedVersion: number;
}

export interface ConfigureNightlyDeliveryInput {
  enabled: boolean;
  expectedSettingsVersion: number;
  expectedRoutineVersion: number;
}

export interface EnqueueRoutineNotificationInput {
  householdId: string;
  routineKind: AgentRoutineKind;
  sourceType: string;
  sourceId: string;
  type: string;
  title: string;
  summary: string;
  targetPath: string;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDateDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shanghaiDayBounds(now = new Date()) {
  const date = shanghaiDate(now);
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function weekdayForShanghaiDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function shanghaiWeekBounds(now = new Date()) {
  const date = shanghaiDate(now);
  const weekday = weekdayForShanghaiDate(date);
  const daysSinceMonday = weekday === SUNDAY ? 6 : weekday - 1;
  const startDate = addDateDays(date, -daysSinceMonday);
  const start = new Date(`${startDate}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

function nextScheduledAt(hour: number, minute: number, now = new Date()) {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const date = shanghaiDate(now);
  const todayCandidate = new Date(`${date}T${time}:00+08:00`);
  if (todayCandidate.getTime() > now.getTime()) return todayCandidate;
  return new Date(`${addDateDays(date, 1)}T${time}:00+08:00`);
}

function nextWeeklyScheduledAt(
  hour: number,
  minute: number,
  now = new Date(),
  weekday = SUNDAY,
) {
  const date = shanghaiDate(now);
  const currentWeekday = weekdayForShanghaiDate(date);
  const daysAhead = (weekday - currentWeekday + 7) % 7;
  const targetDate = addDateDays(date, daysAhead);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const candidate = new Date(`${targetDate}T${time}:00+08:00`);
  if (candidate.getTime() > now.getTime()) return candidate;
  return new Date(`${addDateDays(targetDate, 7)}T${time}:00+08:00`);
}

function shanghaiTimeParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return {
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value),
  };
}

function nextWeeklyAfter(routine: AgentRoutine, now: Date) {
  let next = new Date(routine.nextRunAt.getTime() + 7 * DAY_MS);
  while (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + 7 * DAY_MS);
  }
  return next;
}

function untrustedText(value: string, maximum: number) {
  return value
    .replace(
      /\b(?:AGENT_DATA_KEY|AGENT_MCP_KEY|OPENWEATHER_API_KEY|MOVIEPILOT_API_KEY|PLEX_TOKEN|EMBY_API_KEY)\s*[:=]\s*[^\s,;]+/gi,
      '[敏感信息已隐藏]',
    )
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

@Injectable()
export class AgentRoutineService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    @InjectRepository(AgentRoutine)
    private readonly routines: Repository<AgentRoutine>,
    @InjectRepository(AgentRoutineItem)
    private readonly items: Repository<AgentRoutineItem>,
    @InjectRepository(AgentSetting)
    private readonly settings: Repository<AgentSetting>,
    private readonly calendar: CalendarService,
    private readonly shopping: ShoppingService,
    private readonly inventory: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(
      process.env.AGENT_ROUTINE_POLL_INTERVAL_MS || 15_000,
    );
    const interval = Number.isFinite(configured)
      ? Math.max(100, Math.min(configured, 300_000))
      : 15_000;
    void this.dispatchDue();
    this.timer = setInterval(() => void this.dispatchDue(), interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async list(user: JwtUser) {
    await Promise.all(
      ROUTINE_KINDS.map((kind) => this.ensureRoutine(kind, user)),
    );
    const rows = await this.routines.find({
      where: { householdId: user.householdId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((routine) => this.presentRoutine(routine));
  }

  async update(
    kind: AgentRoutineKind,
    input: UpdateAgentRoutineInput,
    user: JwtUser,
  ) {
    this.assertKind(kind);
    const current = await this.ensureRoutine(kind, user);
    if (current.version !== input.expectedVersion) {
      throw new ConflictException('例行任务设置已被其他成员更新，请刷新后重试');
    }
    let scheduleHour = input.scheduleHour ?? current.scheduleHour;
    let scheduleMinute = input.scheduleMinute ?? current.scheduleMinute;
    let nextRunAt: Date;
    if (kind === 'weekly_report') {
      if (input.nextRunAt) {
        nextRunAt = new Date(input.nextRunAt);
        if (
          !Number.isFinite(nextRunAt.getTime()) ||
          nextRunAt.getTime() <= Date.now()
        ) {
          throw new BadRequestException('周报下次执行时间必须晚于当前时间');
        }
        const parts = shanghaiTimeParts(nextRunAt);
        if (
          (input.scheduleHour != null && input.scheduleHour !== parts.hour) ||
          (input.scheduleMinute != null && input.scheduleMinute !== parts.minute)
        ) {
          throw new BadRequestException('周报时间与下次执行时间不一致');
        }
        scheduleHour = parts.hour;
        scheduleMinute = parts.minute;
      } else if (
        input.scheduleHour != null ||
        input.scheduleMinute != null ||
        current.nextRunAt.getTime() <= Date.now()
      ) {
        nextRunAt = nextWeeklyScheduledAt(
          scheduleHour,
          scheduleMinute,
          new Date(),
          weekdayForShanghaiDate(shanghaiDate(current.nextRunAt)),
        );
      } else {
        nextRunAt = current.nextRunAt;
      }
    } else {
      if (input.nextRunAt) {
        throw new BadRequestException('每晚汇总请使用小时和分钟设置时间');
      }
      nextRunAt = nextScheduledAt(scheduleHour, scheduleMinute);
    }
    const result = await this.routines.update(
      { id: current.id, version: input.expectedVersion },
      {
        enabled: input.enabled ?? current.enabled,
        scheduleHour,
        scheduleMinute,
        nextRunAt,
        version: current.version + 1,
      },
    );
    if (!result.affected) {
      throw new ConflictException('例行任务设置已被其他成员更新，请刷新后重试');
    }
    return this.presentRoutine(
      (await this.routines.findOneBy({ id: current.id }))!,
    );
  }

  async configureNightlyDelivery(
    input: ConfigureNightlyDeliveryInput,
    user: JwtUser,
  ) {
    await this.ensureRoutine('nightly_digest', user);
    return this.dataSource.transaction(async (manager) => {
      const setting = await manager
        .getRepository(AgentSetting)
        .createQueryBuilder('setting')
        .where('setting.householdId = :householdId', {
          householdId: user.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();
      const routine = await manager
        .getRepository(AgentRoutine)
        .createQueryBuilder('routine')
        .where('routine.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('routine.kind = :kind', { kind: 'nightly_digest' })
        .setLock('pessimistic_write')
        .getOne();
      if (!setting || !routine) {
        throw new BadRequestException('小管家提醒设置尚未初始化，请刷新后重试');
      }
      if (
        setting.version !== input.expectedSettingsVersion ||
        routine.version !== input.expectedRoutineVersion
      ) {
        throw new ConflictException('提醒设置已被其他成员更新，请刷新后重试');
      }
      setting.routineNotificationsEnabled = input.enabled;
      setting.updatedByMemberId = user.memberId;
      setting.version += 1;
      routine.enabled = input.enabled;
      routine.nextRunAt = nextScheduledAt(
        routine.scheduleHour,
        routine.scheduleMinute,
      );
      routine.version += 1;
      await manager.getRepository(AgentSetting).save(setting);
      await manager.getRepository(AgentRoutine).save(routine);
      return {
        enabled: input.enabled,
        routine: this.presentRoutine(routine),
        settingsVersion: setting.version,
      };
    });
  }

  async enqueueNotification(input: EnqueueRoutineNotificationInput) {
    this.assertKind(input.routineKind);
    return this.dataSource.transaction(async (manager) => {
      const settings = manager.getRepository(AgentSetting);
      const setting = await settings
        .createQueryBuilder('setting')
        .where('setting.householdId = :householdId', {
          householdId: input.householdId,
        })
        .setLock('pessimistic_write')
        .getOne();

      const notifications = manager.getRepository(Notification);
      const existing = await notifications.findOneBy({
        householdId: input.householdId,
        module: 'agent',
        type: untrustedText(input.type, 64),
        sourceId: input.sourceId,
      });
      if (existing) {
        return { delivered: false, queued: false, duplicate: true };
      }

      if (!setting?.routineNotificationsEnabled) {
        const queued = await this.queuePending(manager, input);
        return { delivered: false, queued, duplicate: !queued };
      }

      const { start, end } = shanghaiDayBounds();
      const sentToday = await notifications
        .createQueryBuilder('notification')
        .where('notification.householdId = :householdId', {
          householdId: input.householdId,
        })
        .andWhere('notification.module = :module', { module: 'agent' })
        .andWhere('notification.createdAt >= :start', { start })
        .andWhere('notification.createdAt < :end', { end })
        .getCount();
      if (sentToday >= setting.dailyRoutineNotificationLimit) {
        const queued = await this.queuePending(manager, input);
        return { delivered: false, queued, duplicate: !queued };
      }

      const owner = await manager.getRepository(Member).findOne({
        where: {
          householdId: input.householdId,
          role: 'owner',
          disabledAt: IsNull(),
        },
        order: { createdAt: 'ASC' },
      });
      if (!owner) {
        const queued = await this.queuePending(manager, input);
        return { delivered: false, queued, duplicate: !queued };
      }

      await notifications.save(
        notifications.create({
          householdId: input.householdId,
          recipientId: owner.id,
          module: 'agent',
          type: untrustedText(input.type, 64),
          sourceId: input.sourceId,
          title: untrustedText(input.title, 160) || '家庭小管家提醒',
          body: untrustedText(input.summary, 500) || null,
          targetPath: untrustedText(input.targetPath, 500) || '/assistant',
        }),
      );
      return { delivered: true, queued: false, duplicate: false };
    });
  }

  // This worker intentionally has no AgentProposalsService dependency. Any
  // future routine write must create an unconfirmed proposal for a person to review.
  async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.dataSource.transaction(async (manager) => {
        const routines = manager.getRepository(AgentRoutine);
        const notifications = manager.getRepository(Notification);
        const now = new Date();
        const due = await routines
          .createQueryBuilder('routine')
          .where('routine.enabled = :enabled', { enabled: true })
          .andWhere('routine.nextRunAt <= :now', { now })
          .orderBy('routine.nextRunAt', 'ASC')
          .take(25)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        for (const routine of due) {
          const advance = async () => {
            routine.lastRunAt = now;
            routine.nextRunAt =
              routine.kind === 'weekly_report'
                ? nextWeeklyAfter(routine, now)
                : nextScheduledAt(
                    routine.scheduleHour,
                    routine.scheduleMinute,
                    now,
                  );
            await routines.save(routine);
          };
          try {
            const setting = await manager
              .getRepository(AgentSetting)
              .findOneBy({ householdId: routine.householdId });
            if (!setting?.routineNotificationsEnabled) {
              await advance();
              continue;
            }

            const owner = await manager.getRepository(Member).findOne({
              where: {
                householdId: routine.householdId,
                role: 'owner',
                disabledAt: IsNull(),
              },
              order: { createdAt: 'ASC' },
            });
            if (!owner) {
              console.error(
                JSON.stringify({
                  event: 'agent_routine_owner_unavailable',
                  errorName: 'OwnerUnavailable',
                }),
              );
              await advance();
              continue;
            }

            const window =
              routine.kind === 'weekly_report'
                ? shanghaiWeekBounds(now)
                : shanghaiDayBounds(now);
            const notificationType =
              routine.kind === 'weekly_report'
                ? 'agent_weekly_report'
                : 'agent_nightly_digest';
            const duplicate = await notifications
              .createQueryBuilder('notification')
              .where('notification.householdId = :householdId', {
                householdId: routine.householdId,
              })
              .andWhere('notification.module = :module', { module: 'agent' })
              .andWhere('notification.type = :type', {
                type: notificationType,
              })
              .andWhere('notification.sourceId = :sourceId', {
                sourceId: routine.id,
              })
              .andWhere('notification.createdAt >= :start', {
                start: window.start,
              })
              .andWhere('notification.createdAt < :end', { end: window.end })
              .getOne();
            if (duplicate) {
              await advance();
              continue;
            }

            if (routine.kind === 'weekly_report') {
              await this.sendWeeklyReport(manager, routine, owner, now);
            } else {
              await this.sendNightlyDigest(manager, routine, owner, now);
            }
            await advance();
          } catch (error) {
            console.error(
              JSON.stringify({
                event: 'agent_routine_row_failed',
                errorName:
                  error instanceof Error ? error.name : 'UnknownError',
              }),
            );
            await advance();
          }
        }
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'agent_routine_dispatch_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    } finally {
      this.dispatching = false;
    }
  }

  private async sendNightlyDigest(
    manager: EntityManager,
    routine: AgentRoutine,
    owner: Member,
    now: Date,
  ) {
    await this.collectExpiryItems(manager, routine.householdId, now);
    const pending = await manager.getRepository(AgentRoutineItem).find({
      where: {
        householdId: routine.householdId,
        routineKind: 'nightly_digest',
        status: 'pending',
      },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const date = shanghaiDate(now);
    const calendarEntries = await this.calendar.list(
      date,
      date,
      this.ownerUser(owner),
    );
    const { body, digestedIds } = this.buildDigest(pending, calendarEntries);
    const notifications = manager.getRepository(Notification);
    await notifications.save(
      notifications.create({
        householdId: routine.householdId,
        recipientId: owner.id,
        module: 'agent',
        type: 'agent_nightly_digest',
        sourceId: routine.id,
        title: '家庭小管家每晚汇总'.slice(0, 160),
        body: body.slice(0, 500),
        targetPath: '/assistant',
      }),
    );
    if (digestedIds.length) {
      await manager
        .getRepository(AgentRoutineItem)
        .createQueryBuilder()
        .update()
        .set({ status: 'digested', digestedAt: now })
        .whereInIds(digestedIds)
        .execute();
    }
  }

  private async collectExpiryItems(
    manager: EntityManager,
    householdId: string,
    now: Date,
  ) {
    const today = shanghaiDate(now);
    const through = addDateDays(today, 14);
    const { start, end } = shanghaiDayBounds(now);

    await manager.query(
      `INSERT INTO agent_routine_items (
         "householdId", "routineKind", "sourceType", "sourceId", summary, status
       )
       SELECT candidate."householdId", 'nightly_digest', 'subscription_renewal',
              candidate.id::text,
              format(
                '订阅「%s」将在 %s 天后（%s 月 %s 日）到期',
                candidate.name,
                candidate."renewsOn" - $2::date,
                extract(month FROM candidate."renewsOn")::int,
                extract(day FROM candidate."renewsOn")::int
              ),
              'pending'
       FROM (
         SELECT id, "householdId", name, "renewsOn"
         FROM home_assets
         WHERE "householdId" = $1
           AND category = 'subscription'
           AND status = 'active'
           AND "renewsOn" IS NOT NULL
           AND "renewsOn" >= $2::date
           AND "renewsOn" <= $3::date
         ORDER BY "renewsOn" ASC, id ASC
         LIMIT 5
       ) candidate
       WHERE NOT EXISTS (
         SELECT 1
         FROM agent_routine_items existing
         WHERE existing."householdId" = candidate."householdId"
           AND existing."routineKind" = 'nightly_digest'
           AND existing."sourceType" = 'subscription_renewal'
           AND existing."sourceId" = candidate.id::text
           AND existing.status IN ('pending', 'digested')
           AND existing."createdAt" >= $4
           AND existing."createdAt" < $5
       )`,
      [householdId, today, through, start, end],
    );

    await manager.query(
      `INSERT INTO agent_routine_items (
         "householdId", "routineKind", "sourceType", "sourceId", summary, status
       )
       SELECT candidate."householdId", 'nightly_digest', 'medicine_expiry',
              candidate.id::text,
              format(
                '药品「%s」将在 %s 天后（%s 月 %s 日）到期',
                candidate.name,
                candidate."expiresOn" - $2::date,
                extract(month FROM candidate."expiresOn")::int,
                extract(day FROM candidate."expiresOn")::int
              ),
              'pending'
       FROM (
         SELECT batch.id, batch."householdId", item.name, batch."expiresOn"
         FROM inventory_batches batch
         INNER JOIN inventory_items item
           ON item.id = batch."inventoryItemId"
          AND item."householdId" = batch."householdId"
         WHERE batch."householdId" = $1
           AND item.category = '药品'
           AND batch.quantity > 0
           AND batch."expiresOn" IS NOT NULL
           AND batch."expiresOn" >= $2::date
           AND batch."expiresOn" <= $3::date
         ORDER BY batch."expiresOn" ASC, batch.id ASC
         LIMIT 5
       ) candidate
       WHERE NOT EXISTS (
         SELECT 1
         FROM agent_routine_items existing
         WHERE existing."householdId" = candidate."householdId"
           AND existing."routineKind" = 'nightly_digest'
           AND existing."sourceType" = 'medicine_expiry'
           AND existing."sourceId" = candidate.id::text
           AND existing.status IN ('pending', 'digested')
           AND existing."createdAt" >= $4
           AND existing."createdAt" < $5
       )`,
      [householdId, today, through, start, end],
    );
  }

  private async sendWeeklyReport(
    manager: EntityManager,
    routine: AgentRoutine,
    owner: Member,
    now: Date,
  ) {
    const endDate = shanghaiDate(now);
    const startDate = addDateDays(endDate, -6);
    const dates = Array.from({ length: 7 }, (_, index) =>
      addDateDays(startDate, index),
    );
    const start = new Date(`${startDate}T00:00:00+08:00`);
    const end = new Date(`${addDateDays(endDate, 1)}T00:00:00+08:00`);
    const [calendarEntries, shoppingLists, inventoryItems, blockedCount] =
      await Promise.all([
        this.calendar.list(startDate, endDate, this.ownerUser(owner)),
        Promise.all(
          dates.map((date) => this.shopping.list(routine.householdId, date)),
        ),
        this.inventory.list(routine.householdId),
        manager
          .getRepository(AgentRoutineItem)
          .createQueryBuilder('item')
          .where('item.householdId = :householdId', {
            householdId: routine.householdId,
          })
          .andWhere('item.createdAt >= :start', { start })
          .andWhere('item.createdAt < :end', { end })
          .getCount(),
      ]);

    const completedTasks = calendarEntries.filter(
      (entry) => entry.module === 'task' && entry.status === 'done',
    ).length;
    const menus = calendarEntries.filter((entry) => entry.module === 'menu');
    const completedMenus = menus.filter((entry) => entry.status === 'done').length;
    const shoppingItems = shoppingLists.flat();
    const checkedShoppingItems = shoppingItems.filter(
      (item) => item.checked,
    ).length;
    const inventoryAlerts = inventoryItems.filter(
      (item) =>
        Number(item.quantity) <= Number(item.lowStockThreshold) ||
        (item.batchSummary?.expiringCount ?? 0) > 0 ||
        (item.batchSummary?.expiredCount ?? 0) > 0,
    ).length;
    const body = [
      `本周回顾（${startDate} 至 ${endDate}）`,
      `完成任务 ${completedTasks} 项；菜单执行 ${completedMenus}/${menus.length} 餐。`,
      `购物清单完成 ${checkedShoppingItems}/${shoppingItems.length} 项；当前库存告警 ${inventoryAlerts} 项。`,
      `本周受通知上限或通知关闭影响进入汇总 ${blockedCount} 项。`,
    ]
      .join('\n')
      .slice(0, 500);

    const notifications = manager.getRepository(Notification);
    await notifications.save(
      notifications.create({
        householdId: routine.householdId,
        recipientId: owner.id,
        module: 'agent',
        type: 'agent_weekly_report',
        sourceId: routine.id,
        title: '家庭小管家每周回顾'.slice(0, 160),
        body,
        targetPath: '/assistant',
      }),
    );
  }

  private ownerUser(owner: Member): JwtUser {
    return {
      sub: owner.accountId ?? '',
      accountId: owner.accountId ?? '',
      memberId: owner.id,
      householdId: owner.householdId,
      sid: '',
      name: owner.name,
      role: owner.role,
    };
  }

  private async ensureRoutine(kind: AgentRoutineKind, user: JwtUser) {
    this.assertKind(kind);
    const existing = await this.routines.findOneBy({
      householdId: user.householdId,
      kind,
    });
    if (existing) return existing;
    const scheduleHour =
      kind === 'weekly_report' ? DEFAULT_WEEKLY_HOUR : DEFAULT_NIGHTLY_HOUR;
    const nextRunAt =
      kind === 'weekly_report'
        ? nextWeeklyScheduledAt(scheduleHour, DEFAULT_SCHEDULE_MINUTE)
        : nextScheduledAt(scheduleHour, DEFAULT_SCHEDULE_MINUTE);
    try {
      return await this.routines.save(
        this.routines.create({
          householdId: user.householdId,
          kind,
          enabled: false,
          scheduleHour,
          scheduleMinute: DEFAULT_SCHEDULE_MINUTE,
          lastRunAt: null,
          nextRunAt,
          version: 1,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.routines.findOneBy({
          householdId: user.householdId,
          kind,
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async queuePending(
    manager: EntityManager,
    input: EnqueueRoutineNotificationInput,
  ) {
    const items = manager.getRepository(AgentRoutineItem);
    const existing = await items.findOneBy({
      householdId: input.householdId,
      routineKind: input.routineKind,
      sourceType: untrustedText(input.sourceType, 40),
      sourceId: untrustedText(input.sourceId, 120),
    });
    if (existing) return false;
    const summary = untrustedText(input.summary, 200);
    if (!summary) throw new BadRequestException('例行通知摘要不能为空');
    await items.save(
      items.create({
        householdId: input.householdId,
        routineKind: input.routineKind,
        sourceType: untrustedText(input.sourceType, 40) || 'unknown',
        sourceId: untrustedText(input.sourceId, 120),
        summary,
        status: 'pending',
        digestedAt: null,
      }),
    );
    return true;
  }

  private buildDigest(
    pending: AgentRoutineItem[],
    calendarEntries: Awaited<ReturnType<CalendarService['list']>>,
  ) {
    const taskCount = calendarEntries.filter(
      (entry) => entry.module === 'task' && entry.status === 'pending',
    ).length;
    const menuCount = calendarEntries.filter(
      (entry) => entry.module === 'menu',
    ).length;
    const scheduleCount = calendarEntries.filter(
      (entry) => !['task', 'menu'].includes(entry.module),
    ).length;
    const parts = [
      `今日要闻：待办 ${taskCount} 项，家庭安排 ${scheduleCount} 项，菜单 ${menuCount} 餐。`,
    ];
    const digestedIds: string[] = [];
    for (const item of pending) {
      const line = `待处理：${untrustedText(item.summary, 200)}`;
      const candidate = [...parts, line].join('\n');
      if (candidate.length > 500) break;
      parts.push(line);
      digestedIds.push(item.id);
    }
    if (!digestedIds.length && !calendarEntries.length) {
      parts.push('今天没有待处理事项。');
    }
    return { body: parts.join('\n').slice(0, 500), digestedIds };
  }

  private assertKind(kind: string): asserts kind is AgentRoutineKind {
    if (!ROUTINE_KINDS.includes(kind as AgentRoutineKind)) {
      throw new BadRequestException('不支持的例行任务类型');
    }
  }

  private presentRoutine(routine: AgentRoutine) {
    return {
      id: routine.id,
      kind: routine.kind,
      enabled: routine.enabled,
      scheduleHour: routine.scheduleHour,
      scheduleMinute: routine.scheduleMinute,
      lastRunAt: routine.lastRunAt,
      nextRunAt: routine.nextRunAt,
      version: routine.version,
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    };
  }
}
