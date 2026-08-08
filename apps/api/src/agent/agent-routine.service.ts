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

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_SCHEDULE_HOUR = 21;
const DEFAULT_SCHEDULE_MINUTE = 0;

export interface UpdateAgentRoutineInput {
  enabled?: boolean;
  scheduleHour?: number;
  scheduleMinute?: number;
  expectedVersion: number;
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
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function nextScheduledAt(hour: number, minute: number, now = new Date()) {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const date = shanghaiDate(now);
  const todayCandidate = new Date(`${date}T${time}:00+08:00`);
  if (todayCandidate.getTime() > now.getTime()) return todayCandidate;
  return new Date(`${addDateDays(date, 1)}T${time}:00+08:00`);
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
    await this.ensureRoutine('nightly_digest', user);
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
    const scheduleHour = input.scheduleHour ?? current.scheduleHour;
    const scheduleMinute = input.scheduleMinute ?? current.scheduleMinute;
    const result = await this.routines.update(
      { id: current.id, version: input.expectedVersion },
      {
        enabled: input.enabled ?? current.enabled,
        scheduleHour,
        scheduleMinute,
        nextRunAt: nextScheduledAt(scheduleHour, scheduleMinute),
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
            routine.nextRunAt = nextScheduledAt(
              routine.scheduleHour,
              routine.scheduleMinute,
              now,
            );
            await routines.save(routine);
          };
          const setting = await manager.getRepository(AgentSetting).findOneBy({
            householdId: routine.householdId,
          });
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

          const { start, end } = shanghaiDayBounds(now);
          const duplicate = await notifications
            .createQueryBuilder('notification')
            .where('notification.householdId = :householdId', {
              householdId: routine.householdId,
            })
            .andWhere('notification.module = :module', { module: 'agent' })
            .andWhere('notification.type = :type', {
              type: 'agent_nightly_digest',
            })
            .andWhere('notification.sourceId = :sourceId', {
              sourceId: routine.id,
            })
            .andWhere('notification.createdAt >= :start', { start })
            .andWhere('notification.createdAt < :end', { end })
            .getOne();
          if (duplicate) {
            await advance();
            continue;
          }

          const pending = await manager.getRepository(AgentRoutineItem).find({
            where: {
              householdId: routine.householdId,
              routineKind: routine.kind,
              status: 'pending',
            },
            order: { createdAt: 'ASC' },
            take: 100,
          });
          const date = shanghaiDate(now);
          const calendarEntries = await this.calendar.list(date, date, {
            sub: owner.accountId ?? '',
            accountId: owner.accountId ?? '',
            memberId: owner.id,
            householdId: owner.householdId,
            sid: '',
            name: owner.name,
            role: owner.role,
          });
          const { body, digestedIds } = this.buildDigest(
            pending,
            calendarEntries,
          );

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
          await advance();
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

  private async ensureRoutine(kind: AgentRoutineKind, user: JwtUser) {
    this.assertKind(kind);
    const existing = await this.routines.findOneBy({
      householdId: user.householdId,
      kind,
    });
    if (existing) return existing;
    try {
      return await this.routines.save(
        this.routines.create({
          householdId: user.householdId,
          kind,
          enabled: false,
          scheduleHour: DEFAULT_SCHEDULE_HOUR,
          scheduleMinute: DEFAULT_SCHEDULE_MINUTE,
          lastRunAt: null,
          nextRunAt: nextScheduledAt(
            DEFAULT_SCHEDULE_HOUR,
            DEFAULT_SCHEDULE_MINUTE,
          ),
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
    if (kind !== 'nightly_digest') {
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
