import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  DataSource,
  Between,
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { CalendarModule, CalendarService } from '../calendar/calendar.module';
import {
  CalendarEvent,
  HouseholdTask,
  HouseholdTaskInstance,
  MealType,
  Member,
  Menu,
  MaintenancePlan,
  Notification,
  Poll,
  Reminder,
  ReminderRecipient,
  ReminderSourceModule,
  ReminderStatus,
  TravelPlan,
} from '../entities';
import { taskOccursOn, TasksModule } from '../tasks/tasks.module';

class ReminderSourceRangeDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;
}

class ReminderQueryDto {
  @IsOptional()
  @IsIn(['scheduled', 'sent', 'cancelled', 'all'])
  status?: ReminderStatus | 'all';
}

class CreateReminderDto {
  @IsIn(['menu', 'task', 'calendar', 'poll', 'maintenance', 'travel'])
  sourceModule: ReminderSourceModule;

  @IsUUID()
  sourceId: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurrenceDate?: string | null;

  @IsISO8601({ strict: true })
  remindAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recipientIds: string[];
}

class UpdateReminderDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  remindAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recipientIds?: string[];
}

interface ReminderSource {
  module: ReminderSourceModule;
  sourceId: string;
  occurrenceDate: string | null;
  title: string;
  summary: string | null;
  date: string | null;
  startsAt: string | null;
  targetPath: string;
  status: string;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

function isAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

function normalizedDate(value: string | Date) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function parseRemindAt(value: string) {
  const remindAt = new Date(value);
  if (!Number.isFinite(remindAt.getTime())) {
    throw new BadRequestException('提醒时间无效');
  }
  if (remindAt.getTime() <= Date.now()) {
    throw new BadRequestException('提醒时间必须晚于当前时间');
  }
  return remindAt;
}

function assertOccurrenceDate(module: ReminderSourceModule, value?: string | null) {
  if (module === 'task' && !value) {
    throw new BadRequestException('周期任务提醒需要指定发生日期');
  }
  if (module !== 'task' && value) {
    throw new BadRequestException('只有任务提醒可以指定发生日期');
  }
}

@Injectable()
export class RemindersService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    @InjectRepository(Reminder)
    private readonly reminders: Repository<Reminder>,
    @InjectRepository(Poll)
    private readonly polls: Repository<Poll>,
    private readonly calendar: CalendarService,
    private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(process.env.REMINDER_POLL_INTERVAL_MS || 15_000);
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

  async listSources(query: ReminderSourceRangeDto, user: JwtUser) {
    const [calendarEntries, polls, maintenancePlans] = await Promise.all([
      this.calendar.list(query.start, query.end, user),
      this.polls.find({
        where: {
          householdId: user.householdId,
          isArchived: false,
          status: 'open',
        },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.dataSource.getRepository(MaintenancePlan).find({
        where: {
          householdId: user.householdId,
          isEnabled: true,
          nextDueDate: Between(query.start, query.end),
        },
        order: { nextDueDate: 'ASC', createdAt: 'ASC' },
        take: 100,
      }),
    ]);
    const now = Date.now();
    const pollSources: ReminderSource[] = polls
      .filter((poll) => !poll.closesAt || poll.closesAt.getTime() > now)
      .filter((poll) => {
        if (!poll.closesAt) return true;
        const date = poll.closesAt.toISOString().slice(0, 10);
        return date >= query.start && date <= query.end;
      })
      .map((poll) => ({
        module: 'poll',
        sourceId: poll.id,
        occurrenceDate: null,
        title: poll.title,
        summary: poll.description,
        date: poll.closesAt?.toISOString().slice(0, 10) ?? null,
        startsAt: poll.closesAt?.toISOString() ?? null,
        targetPath: `/polls?pollId=${poll.id}`,
        status: 'open',
      }));

    const calendarSources = calendarEntries
      .filter((entry) => entry.module !== 'media' && entry.module !== 'guest')
      .filter((entry) => {
        if (entry.module === 'menu') return entry.status === 'open';
        if (entry.module === 'task') return entry.status === 'pending';
        if (entry.module === 'travel') return entry.status === 'planned';
        return true;
      })
      .map<ReminderSource>((entry) => ({
        module: entry.module,
        sourceId: entry.sourceId,
        occurrenceDate: entry.module === 'task' ? entry.date : null,
        title: entry.title,
        summary: entry.summary,
        date: entry.date,
        startsAt: entry.startsAt,
        targetPath: entry.targetPath,
        status: entry.status,
      }));

    const maintenanceSources = maintenancePlans
      .filter((plan) => plan.asset.status === 'active')
      .map<ReminderSource>((plan) => ({
        module: 'maintenance',
        sourceId: plan.id,
        occurrenceDate: null,
        title: `${plan.asset.name} · ${plan.title}`,
        summary: plan.note,
        date: plan.nextDueDate,
        startsAt: null,
        targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
        status: 'scheduled',
      }));

    return [...calendarSources, ...pollSources, ...maintenanceSources].sort((left, right) => {
      const leftTime = left.startsAt ?? left.date ?? '9999-12-31';
      const rightTime = right.startsAt ?? right.date ?? '9999-12-31';
      return leftTime.localeCompare(rightTime) || left.title.localeCompare(right.title, 'zh-CN');
    });
  }

  async list(query: ReminderQueryDto, user: JwtUser) {
    const reminders = await this.reminders.find({
      where: {
        householdId: user.householdId,
        ...(query.status && query.status !== 'all'
          ? { status: query.status }
          : {}),
      },
      relations: { recipients: true },
      order: { remindAt: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
    return Promise.all(
      reminders.map(async (reminder) =>
        this.present(
          reminder,
          user,
          await this.resolveSource(this.dataSource.manager, reminder, false),
        ),
      ),
    );
  }

  async create(dto: CreateReminderDto, user: JwtUser) {
    assertOccurrenceDate(dto.sourceModule, dto.occurrenceDate);
    const remindAt = parseRemindAt(dto.remindAt);
    const id = await this.dataSource.transaction(async (manager) => {
      const source = await this.resolveSource(
        manager,
        {
          householdId: user.householdId,
          sourceModule: dto.sourceModule,
          sourceId: dto.sourceId,
          occurrenceDate: dto.occurrenceDate ?? null,
        },
        true,
      );
      if (!source) throw new NotFoundException('关联事项不存在或已经结束');
      const members = await this.requireMembers(dto.recipientIds, user, manager);
      const reminders = manager.getRepository(Reminder);
      const recipients = manager.getRepository(ReminderRecipient);
      const reminder = await reminders.save(
        reminders.create({
          householdId: user.householdId,
          sourceModule: dto.sourceModule,
          sourceId: dto.sourceId,
          occurrenceDate: dto.occurrenceDate ?? null,
          remindAt,
          status: 'scheduled',
          createdById: user.memberId,
          sentAt: null,
          cancelledAt: null,
          cancelReason: null,
        }),
      );
      await recipients.save(
        members.map((member) =>
          recipients.create({
            householdId: user.householdId,
            reminderId: reminder.id,
            memberId: member.id,
            notificationId: null,
            deliveredAt: null,
          }),
        ),
      );
      return reminder.id;
    });
    return this.get(id, user);
  }

  async update(id: string, dto: UpdateReminderDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const reminder = await this.lockReminder(id, user, manager);
      this.assertManageable(reminder, user);
      if (reminder.status !== 'scheduled') {
        throw new ConflictException('已经发送或取消的提醒不能修改');
      }
      const source = await this.resolveSource(manager, reminder, true);
      if (!source) throw new ConflictException('关联事项已经结束或不可用');
      if (dto.remindAt) reminder.remindAt = parseRemindAt(dto.remindAt);
      await manager.getRepository(Reminder).save(reminder);

      if (dto.recipientIds) {
        const members = await this.requireMembers(dto.recipientIds, user, manager);
        const recipients = manager.getRepository(ReminderRecipient);
        await recipients.delete({ reminderId: reminder.id });
        await recipients.save(
          members.map((member) =>
            recipients.create({
              householdId: user.householdId,
              reminderId: reminder.id,
              memberId: member.id,
              notificationId: null,
              deliveredAt: null,
            }),
          ),
        );
      }
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const reminder = await this.lockReminder(id, user, manager);
      this.assertManageable(reminder, user);
      if (reminder.status === 'sent') {
        throw new ConflictException('已经发送的提醒不能取消');
      }
      if (reminder.status === 'cancelled') return;
      reminder.status = 'cancelled';
      reminder.cancelledAt = new Date();
      reminder.cancelReason = 'manual';
      await manager.getRepository(Reminder).save(reminder);
    });
    return this.get(id, user);
  }

  private async get(id: string, user: JwtUser) {
    const reminder = await this.reminders.findOne({
      where: { id, householdId: user.householdId },
      relations: { recipients: true },
    });
    if (!reminder) throw new NotFoundException('提醒不存在');
    const source = await this.resolveSource(this.dataSource.manager, reminder, false);
    return this.present(reminder, user, source);
  }

  private present(
    reminder: Reminder,
    user: JwtUser,
    source: ReminderSource | null,
  ) {
    return {
      id: reminder.id,
      sourceModule: reminder.sourceModule,
      sourceId: reminder.sourceId,
      occurrenceDate: reminder.occurrenceDate,
      remindAt: reminder.remindAt.toISOString(),
      status: reminder.status,
      source,
      createdById: reminder.createdById,
      createdBy: reminder.createdBy,
      recipients: [...(reminder.recipients ?? [])]
        .sort((left, right) => left.member.name.localeCompare(right.member.name, 'zh-CN'))
        .map((recipient) => ({
          id: recipient.id,
          member: recipient.member,
          deliveredAt: recipient.deliveredAt?.toISOString() ?? null,
        })),
      sentAt: reminder.sentAt?.toISOString() ?? null,
      cancelledAt: reminder.cancelledAt?.toISOString() ?? null,
      cancelReason: reminder.cancelReason,
      canManage: reminder.createdById === user.memberId || isAdmin(user),
      createdAt: reminder.createdAt,
      updatedAt: reminder.updatedAt,
    };
  }

  private async resolveSource(
    manager: EntityManager,
    reminder: Pick<
      Reminder,
      'householdId' | 'sourceModule' | 'sourceId' | 'occurrenceDate'
    >,
    actionableOnly: boolean,
  ): Promise<ReminderSource | null> {
    if (reminder.sourceModule === 'menu') {
      const menu = await manager.getRepository(Menu).findOne({
        where: { id: reminder.sourceId, householdId: reminder.householdId },
        relations: { items: true },
      });
      if (!menu) return null;
      const activeItems = menu.items.filter((item) => item.status !== 'rejected');
      if (actionableOnly && (menu.status !== 'open' || !activeItems.length)) return null;
      return {
        module: 'menu',
        sourceId: menu.id,
        occurrenceDate: null,
        title: `${MEAL_LABELS[menu.mealType]}菜单`,
        summary: activeItems.length
          ? activeItems.map((item) => item.dish.name).slice(0, 5).join('、')
          : null,
        date: normalizedDate(menu.date),
        startsAt: null,
        targetPath: `/kitchen?date=${normalizedDate(menu.date)}&mealType=${menu.mealType}`,
        status: menu.status,
      };
    }

    if (reminder.sourceModule === 'calendar') {
      const event = await manager.getRepository(CalendarEvent).findOneBy({
        id: reminder.sourceId,
        householdId: reminder.householdId,
      });
      if (!event) return null;
      return {
        module: 'calendar',
        sourceId: event.id,
        occurrenceDate: null,
        title: event.title,
        summary: event.note,
        date: normalizedDate(event.date),
        startsAt: event.startsAt?.toISOString() ?? null,
        targetPath: `/calendar?date=${normalizedDate(event.date)}&eventId=${event.id}`,
        status: 'scheduled',
      };
    }

    if (reminder.sourceModule === 'task') {
      if (!reminder.occurrenceDate) return null;
      const task = await manager.getRepository(HouseholdTask).findOneBy({
        id: reminder.sourceId,
        householdId: reminder.householdId,
      });
      if (!task || !taskOccursOn(task, reminder.occurrenceDate)) return null;
      const instance = await manager.getRepository(HouseholdTaskInstance).findOneBy({
        householdId: reminder.householdId,
        taskId: task.id,
        dueDate: reminder.occurrenceDate,
      });
      const status = instance?.status ?? 'pending';
      if (actionableOnly && (task.isArchived || status !== 'pending')) return null;
      return {
        module: 'task',
        sourceId: task.id,
        occurrenceDate: reminder.occurrenceDate,
        title: task.title,
        summary: task.note,
        date: reminder.occurrenceDate,
        startsAt: null,
        targetPath: `/tasks?date=${reminder.occurrenceDate}&taskId=${task.id}`,
        status,
      };
    }

    if (reminder.sourceModule === 'maintenance') {
      const plan = await manager.getRepository(MaintenancePlan).findOneBy({
        id: reminder.sourceId,
        householdId: reminder.householdId,
      });
      if (!plan) return null;
      const active = plan.isEnabled && plan.asset.status === 'active';
      if (actionableOnly && !active) return null;
      return {
        module: 'maintenance',
        sourceId: plan.id,
        occurrenceDate: null,
        title: `${plan.asset.name} · ${plan.title}`,
        summary: plan.note,
        date: plan.nextDueDate,
        startsAt: null,
        targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
        status: active ? 'scheduled' : 'cancelled',
      };
    }

    if (reminder.sourceModule === 'travel') {
      const plan = await manager.getRepository(TravelPlan).findOne({
        where: { id: reminder.sourceId, householdId: reminder.householdId },
        relations: { items: true },
      });
      if (!plan || plan.archivedAt) return null;
      const activeItems = plan.items.filter((item) => !item.archivedAt);
      const completed = activeItems.filter(
        (item) => item.status === 'completed',
      ).length;
      const active = plan.status === 'planned';
      if (actionableOnly && !active) return null;
      return {
        module: 'travel',
        sourceId: plan.id,
        occurrenceDate: null,
        title: plan.title,
        summary: [
          plan.destination,
          `${completed}/${activeItems.length} 项完成`,
        ]
          .filter(Boolean)
          .join(' · '),
        date: plan.startDate,
        startsAt: null,
        targetPath: `/travel?planId=${plan.id}`,
        status: plan.status,
      };
    }

    const poll = await manager.getRepository(Poll).findOneBy({
      id: reminder.sourceId,
      householdId: reminder.householdId,
    });
    if (!poll) return null;
    const open =
      !poll.isArchived &&
      poll.status === 'open' &&
      (!poll.closesAt || poll.closesAt.getTime() > Date.now());
    if (actionableOnly && !open) return null;
    return {
      module: 'poll',
      sourceId: poll.id,
      occurrenceDate: null,
      title: poll.title,
      summary: poll.description,
      date: poll.closesAt?.toISOString().slice(0, 10) ?? null,
      startsAt: poll.closesAt?.toISOString() ?? null,
      targetPath: `/polls?pollId=${poll.id}`,
      status: open ? 'open' : 'closed',
    };
  }

  private async requireMembers(
    memberIds: string[],
    user: JwtUser,
    manager: EntityManager,
  ) {
    const members = await manager.getRepository(Member).findBy({
      id: In(memberIds),
      householdId: user.householdId,
    });
    if (members.length !== memberIds.length) {
      throw new NotFoundException('提醒接收人不属于当前家庭');
    }
    return members;
  }

  private async lockReminder(id: string, user: JwtUser, manager: EntityManager) {
    const reminder = await manager
      .getRepository(Reminder)
      .createQueryBuilder('reminder')
      .where('reminder.id = :id', { id })
      .andWhere('reminder.householdId = :householdId', {
        householdId: user.householdId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!reminder) throw new NotFoundException('提醒不存在');
    return reminder;
  }

  private assertManageable(reminder: Reminder, user: JwtUser) {
    if (reminder.createdById !== user.memberId && !isAdmin(user)) {
      throw new ForbiddenException('只能管理自己创建的提醒');
    }
  }

  private async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.dataSource.transaction(async (manager) => {
        const reminders = manager.getRepository(Reminder);
        const recipients = manager.getRepository(ReminderRecipient);
        const notifications = manager.getRepository(Notification);
        const now = new Date();
        const due = await reminders
          .createQueryBuilder('reminder')
          .where('reminder.status = :status', { status: 'scheduled' })
          .andWhere('reminder.remindAt <= :now', { now })
          .orderBy('reminder.remindAt', 'ASC')
          .take(25)
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getMany();

        for (const reminder of due) {
          const source = await this.resolveSource(manager, reminder, true);
          if (!source) {
            reminder.status = 'cancelled';
            reminder.cancelledAt = now;
            reminder.cancelReason = 'source_unavailable';
            await reminders.save(reminder);
            continue;
          }
          const pending = await recipients.find({
            where: { reminderId: reminder.id, deliveredAt: IsNull() },
            order: { createdAt: 'ASC' },
          });
          if (!pending.length) {
            reminder.status = 'sent';
            reminder.sentAt = now;
            await reminders.save(reminder);
            continue;
          }
          const delivered = await notifications.save(
            pending.map((recipient) =>
              notifications.create({
                householdId: reminder.householdId,
                recipientId: recipient.memberId,
                module: 'reminder',
                type: 'reminder_due',
                sourceId: reminder.id,
                title: `提醒：${source.title}`.slice(0, 160),
                body: source.summary?.slice(0, 500) || source.date,
                targetPath: source.targetPath,
              }),
            ),
          );
          await recipients.save(
            pending.map((recipient, index) => ({
              ...recipient,
              notificationId: delivered[index].id,
              deliveredAt: now,
            })),
          );
          reminder.status = 'sent';
          reminder.sentAt = now;
          await reminders.save(reminder);
        }
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'reminder_dispatch_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    } finally {
      this.dispatching = false;
    }
  }
}

@Controller()
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @Get('reminder-sources')
  listSources(
    @Query() query: ReminderSourceRangeDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listSources(query, user);
  }

  @Get('reminders')
  list(@Query() query: ReminderQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Post('reminders')
  create(@Body() dto: CreateReminderDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('reminders/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('reminders/:id')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancel(id, user);
  }
}

@Module({
  imports: [
    CalendarModule,
    TasksModule,
    TypeOrmModule.forFeature([
      Reminder,
      ReminderRecipient,
      Notification,
      Member,
      CalendarEvent,
      Menu,
      HouseholdTask,
      HouseholdTaskInstance,
      Poll,
      MaintenancePlan,
      TravelPlan,
    ]),
  ],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
