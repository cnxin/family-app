import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Between, EntityManager, In, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import type { CalendarEntryView } from '@family/contracts';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { MaintenancePlan, Poll, Reminder, ReminderRecipient, ReminderStatus } from '../entities';
import {
  ReminderSourceRangeDto,
  ReminderQueryDto,
  CreateReminderDto,
  UpdateReminderDto,
} from './reminders.dto';
import {
  ReminderSource,
  parseRemindAt,
  assertOccurrenceDate,
  present,
  resolveSource,
  requireMembers,
  lockReminder,
  assertManageable,
} from './reminders.helpers';

@Injectable()
export class RemindersService {
  constructor(
    @InjectRepository(Reminder)
    private readonly reminders: Repository<Reminder>,
    @InjectRepository(Poll)
    private readonly polls: Repository<Poll>,
    private readonly facades: PluginFacadeRegistry,
    private readonly dataSource: DataSource,
  ) {}

  async listSources(query: ReminderSourceRangeDto, user: JwtUser) {
    const [calendarEntries, polls, maintenancePlans] = await Promise.all([
      // 日历条目走日历门面（J1b），不 import 日历目录
      this.facades.get('calendar').listEntries(query.start, query.end, user),
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
      .filter((entry): entry is CalendarEntryView & { module: ReminderSource['module'] } =>
        entry.module !== 'media' && entry.module !== 'guest')
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
        present(
          reminder,
          user,
          await resolveSource(this.dataSource.manager, reminder, false),
        ),
      ),
    );
  }

  /** 小管家读工具（门面 listWindow）：提醒时间落在 [from, to) 里、没取消的，按提醒时间排。 */
  async listWindow(from: Date, to: Date, user: JwtUser) {
    const reminders = await this.reminders.find({
      where: {
        householdId: user.householdId,
        status: In(['scheduled', 'sent'] as ReminderStatus[]),
        remindAt: Between(from, new Date(to.getTime() - 1)),
      },
      relations: { recipients: true },
      order: { remindAt: 'ASC', createdAt: 'ASC' },
      take: 100,
    });
    return Promise.all(
      reminders.map(async (reminder) =>
        present(reminder, user, await resolveSource(this.dataSource.manager, reminder, false)),
      ),
    );
  }

  async create(dto: CreateReminderDto, user: JwtUser) {
    const id = await this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager),
    );
    return this.get(id, user);
  }

  async createWithinTransaction(
    dto: CreateReminderDto,
    user: JwtUser,
    manager: EntityManager,
  ) {
    assertOccurrenceDate(dto.sourceModule, dto.occurrenceDate);
    const remindAt = parseRemindAt(dto.remindAt);
    const source = await resolveSource(
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
    const members = await requireMembers(dto.recipientIds, user, manager);
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
  }

  async previewSource(dto: CreateReminderDto, user: JwtUser) {
    assertOccurrenceDate(dto.sourceModule, dto.occurrenceDate);
    const source = await resolveSource(
      this.dataSource.manager,
      {
        householdId: user.householdId,
        sourceModule: dto.sourceModule,
        sourceId: dto.sourceId,
        occurrenceDate: dto.occurrenceDate ?? null,
      },
      true,
    );
    if (!source) throw new NotFoundException('关联事项不存在或已经结束');
    const members = await requireMembers(
      dto.recipientIds,
      user,
      this.dataSource.manager,
    );
    return { source, members };
  }

  async update(id: string, dto: UpdateReminderDto, user: JwtUser) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    await this.dataSource.transaction(async (manager) => {
      const reminder = await lockReminder(id, user, manager);
      assertManageable(reminder, user);
      if (reminder.status !== 'scheduled') {
        throw new ConflictException('已经发送或取消的提醒不能修改');
      }
      const source = await resolveSource(manager, reminder, true);
      if (!source) throw new ConflictException('关联事项已经结束或不可用');
      if (dto.remindAt) reminder.remindAt = parseRemindAt(dto.remindAt);
      await manager.getRepository(Reminder).save(reminder);

      if (dto.recipientIds) {
        const members = await requireMembers(dto.recipientIds, user, manager);
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
      const reminder = await lockReminder(id, user, manager);
      assertManageable(reminder, user);
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
    const source = await resolveSource(this.dataSource.manager, reminder, false);
    return present(reminder, user, source);
  }
}
