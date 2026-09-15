import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Between, Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  CalendarEvent,
  HouseholdMedia,
  MaintenancePlan,
  MealType,
  Menu,
  TravelPlan,
  Visit,
} from '../entities';
import { TasksModule, TasksService } from '../tasks/tasks.module';
import { parseDateOnly } from '@family/shared';

class CalendarRangeDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;
}

class CreateCalendarEventDto {
  @IsISO8601({ strict: true })
  date: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class UpdateCalendarEventDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

interface NormalizedCalendarEventInput {
  date: string;
  startsAt: Date | null;
  endsAt: Date | null;
  title: string;
  note: string | null;
}

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};

const MEAL_ORDER: Record<MealType, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
};

function normalizeEventInput(
  input: CreateCalendarEventDto | UpdateCalendarEventDto,
  current?: CalendarEvent,
): NormalizedCalendarEventInput {
  const date = input.date ?? current?.date;
  const title = input.title ?? current?.title;
  if (!date || !title?.trim()) {
    throw new BadRequestException('日期和事件名称不能为空');
  }
  parseDateOnly(date, '事件日期');

  const startsAtValue = Object.prototype.hasOwnProperty.call(input, 'startsAt')
    ? input.startsAt
    : current?.startsAt;
  const endsAtValue = Object.prototype.hasOwnProperty.call(input, 'endsAt')
    ? input.endsAt
    : current?.endsAt;
  const startsAt = startsAtValue ? new Date(startsAtValue) : null;
  const endsAt = endsAtValue ? new Date(endsAtValue) : null;
  if (endsAt && !startsAt) {
    throw new BadRequestException('设置结束时间前需要先设置开始时间');
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('结束时间必须晚于开始时间');
  }

  const noteValue = Object.prototype.hasOwnProperty.call(input, 'note')
    ? input.note
    : current?.note;
  return {
    date,
    startsAt,
    endsAt,
    title: title.trim(),
    note: noteValue?.trim() || null,
  };
}

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(CalendarEvent)
    private readonly events: Repository<CalendarEvent>,
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(HouseholdMedia)
    private readonly householdMedia: Repository<HouseholdMedia>,
    @InjectRepository(Visit) private readonly visits: Repository<Visit>,
    @InjectRepository(MaintenancePlan)
    private readonly maintenancePlans: Repository<MaintenancePlan>,
    @InjectRepository(TravelPlan)
    private readonly travelPlans: Repository<TravelPlan>,
    private readonly tasks: TasksService,
  ) {}

  async list(start: string, end: string, user: JwtUser) {
    const startTime = parseDateOnly(start, '开始日期');
    const endTime = parseDateOnly(end, '结束日期');
    if (startTime > endTime) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    if ((endTime - startTime) / 86_400_000 > 370) {
      throw new BadRequestException('单次最多查询 371 天');
    }

    const [
      events,
      menuRows,
      taskRows,
      mediaRows,
      visits,
      maintenancePlans,
      travelPlans,
    ] =
      await Promise.all([
        this.events.find({
          where: { householdId: user.householdId, date: Between(start, end) },
          order: { date: 'ASC', startsAt: 'ASC', createdAt: 'ASC' },
        }),
      this.menus
        .createQueryBuilder('menu')
        .innerJoin('menu.items', 'item', 'item.status != :rejected', {
          rejected: 'rejected',
        })
        .select('menu.id', 'sourceId')
        .addSelect('menu.date', 'date')
        .addSelect('menu.mealType', 'mealType')
        .addSelect('menu.status', 'status')
        .addSelect('COUNT(item.id)', 'itemCount')
        .where('menu.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('menu.date >= :start', { start })
        .andWhere('menu.date <= :end', { end })
        .groupBy('menu.id')
        .addGroupBy('menu.date')
        .addGroupBy('menu.mealType')
        .addGroupBy('menu.status')
        .getRawMany<{
          sourceId: string;
          date: string | Date;
          mealType: MealType;
          status: 'open' | 'done';
          itemCount: string;
        }>(),
      this.tasks.list(start, end, user),
      this.householdMedia.find({
        where: {
          householdId: user.householdId,
          scheduledFor: Between(start, end),
        },
        relations: { mediaTitle: true },
        order: { scheduledFor: 'ASC', updatedAt: 'DESC' },
      }),
      this.visits.find({
        where: {
          householdId: user.householdId,
          status: 'scheduled',
          startsAt: Between(new Date(`${start}T00:00:00.000Z`), new Date(`${end}T23:59:59.999Z`)),
        },
        relations: { hostMember: true, guests: { guest: true } },
        order: { startsAt: 'ASC' },
      }),
      this.maintenancePlans.find({
        where: {
          householdId: user.householdId,
          isEnabled: true,
          nextDueDate: Between(start, end),
        },
        relations: { asset: true },
        order: { nextDueDate: 'ASC', createdAt: 'ASC' },
      }),
      this.travelPlans.find({
        where: {
          householdId: user.householdId,
          startDate: Between(start, end),
        },
        relations: { items: true },
        order: { startDate: 'ASC', createdAt: 'ASC' },
      }),
    ]);

    const rows = [
      ...menuRows.map((menu) => {
        const date =
          menu.date instanceof Date
            ? menu.date.toISOString().slice(0, 10)
            : String(menu.date).slice(0, 10);
        const itemCount = Number(menu.itemCount);
        return {
          id: `menu:${menu.sourceId}`,
          sourceId: menu.sourceId,
          module: 'menu' as const,
          date,
          startsAt: null,
          endsAt: null,
          title: `${MEAL_LABELS[menu.mealType]}菜单`,
          summary: `${itemCount} 道菜`,
          status: menu.status,
          targetPath: `/kitchen?date=${date}&mealType=${menu.mealType}`,
          metadata: { mealType: menu.mealType, itemCount },
        };
      }),
      ...events.map((event) => ({
        id: `calendar:${event.id}`,
        sourceId: event.id,
        module: 'calendar' as const,
        date: event.date,
        startsAt: event.startsAt?.toISOString() ?? null,
        endsAt: event.endsAt?.toISOString() ?? null,
        title: event.title,
        summary: event.note,
        status: 'scheduled',
        targetPath: `/calendar?date=${event.date}&eventId=${event.id}`,
        metadata: {
          createdById: event.createdById,
          createdByName: event.createdBy.name,
          canManage:
            event.createdById === user.memberId ||
            user.role === 'owner' ||
            user.role === 'admin',
        },
      })),
      ...taskRows.map((occurrence) => ({
        id: `task:${occurrence.taskId}:${occurrence.dueDate}`,
        sourceId: occurrence.taskId,
        module: 'task' as const,
        date: occurrence.dueDate,
        startsAt: null,
        endsAt: null,
        title: occurrence.task.title,
        summary: occurrence.task.note,
        status: occurrence.status,
        targetPath: `/tasks?date=${occurrence.dueDate}&taskId=${occurrence.taskId}`,
        metadata: {
          assigneeId: occurrence.assigneeId,
          assigneeName: occurrence.assignee?.name ?? null,
          recurrence: occurrence.task.recurrence,
          canManage: occurrence.canManageTask,
          canUpdate: occurrence.canUpdate,
        },
      })),
      ...mediaRows.map((entry) => ({
        id: `media:${entry.id}`,
        sourceId: entry.id,
        module: 'media' as const,
        date: entry.scheduledFor as string,
        startsAt: null,
        endsAt: null,
        title: entry.mediaTitle.title,
        summary: [
          entry.mediaTitle.type === 'movie' ? '电影' : '剧集',
          entry.mediaTitle.year ? String(entry.mediaTitle.year) : null,
          entry.note,
        ]
          .filter(Boolean)
          .join(' · '),
        status: entry.status,
        targetPath: `/media?mediaId=${entry.id}`,
        metadata: {
          mediaType: entry.mediaTitle.type,
          year: entry.mediaTitle.year,
        },
      })),
      ...visits.map((visit) => ({
        id: `visit:${visit.id}`,
        sourceId: visit.id,
        module: 'guest' as const,
        date: visit.startsAt.toISOString().slice(0, 10),
        startsAt: visit.startsAt.toISOString(),
        endsAt: visit.endsAt?.toISOString() ?? null,
        title: visit.title,
        summary: visit.guests.map((entry) => entry.guest.name).join('、') || '访客来访',
        status: visit.status,
        targetPath: `/guests?visitId=${visit.id}`,
        metadata: {
          hostMemberId: visit.hostMemberId,
          hostMemberName: visit.hostMember.name,
          guestCount: visit.guests.length,
        },
      })),
      ...maintenancePlans
        .filter((plan) => plan.asset.status === 'active')
        .map((plan) => ({
          id: `maintenance:${plan.id}`,
          sourceId: plan.id,
          module: 'maintenance' as const,
          date: plan.nextDueDate,
          startsAt: null,
          endsAt: null,
          title: `${plan.asset.name} · ${plan.title}`,
          summary: plan.note,
          status: 'scheduled' as const,
          targetPath: `/home-assets?assetId=${plan.assetId}&planId=${plan.id}`,
          metadata: {
            assetId: plan.assetId,
            assetName: plan.asset.name,
            frequencyDays: plan.frequencyDays,
          },
        })),
      ...travelPlans
        .filter((plan) => !plan.archivedAt)
        .map((plan) => {
          const activeItems = plan.items.filter((item) => !item.archivedAt);
          const completed = activeItems.filter(
            (item) => item.status === 'completed',
          ).length;
          return {
            id: `travel:${plan.id}`,
            sourceId: plan.id,
            module: 'travel' as const,
            date: plan.startDate,
            startsAt: null,
            endsAt: null,
            title: plan.title,
            summary: [
              plan.destination,
              plan.endDate === plan.startDate
                ? null
                : `${plan.startDate} 至 ${plan.endDate}`,
              `${completed}/${activeItems.length} 项完成`,
            ]
              .filter(Boolean)
              .join(' · '),
            status: plan.status,
            targetPath: `/travel?planId=${plan.id}`,
            metadata: {
              endDate: plan.endDate,
              destination: plan.destination,
              completedItems: completed,
              totalItems: activeItems.length,
            },
          };
        }),
    ];

    return rows.sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date);
      if (dateOrder) return dateOrder;
      if (left.module !== right.module) {
        const moduleOrder = {
          calendar: 0,
          guest: 1,
          travel: 2,
          maintenance: 3,
          task: 4,
          media: 5,
          menu: 6,
        };
        return moduleOrder[left.module] - moduleOrder[right.module];
      }
      if (left.module === 'menu' && right.module === 'menu') {
        return MEAL_ORDER[left.metadata.mealType] - MEAL_ORDER[right.metadata.mealType];
      }
      return (left.startsAt ?? '').localeCompare(right.startsAt ?? '');
    });
  }

  create(dto: CreateCalendarEventDto, user: JwtUser) {
    return this.events.save(
      this.events.create({
        ...normalizeEventInput(dto),
        householdId: user.householdId,
        createdById: user.memberId,
      }),
    );
  }

  async update(id: string, dto: UpdateCalendarEventDto, user: JwtUser) {
    const event = await this.findOwnedEvent(id, user);
    if (!Object.keys(dto).length) {
      throw new BadRequestException('至少需要修改一个字段');
    }
    Object.assign(event, normalizeEventInput(dto, event));
    return this.events.save(event);
  }

  async remove(id: string, user: JwtUser) {
    const event = await this.findOwnedEvent(id, user);
    await this.events.remove(event);
    return { id, removed: true as const };
  }

  private async findOwnedEvent(id: string, user: JwtUser) {
    const event = await this.events.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!event) throw new NotFoundException('日历事件不存在');
    if (
      event.createdById !== user.memberId &&
      user.role !== 'owner' &&
      user.role !== 'admin'
    ) {
      throw new ForbiddenException('只能管理自己创建的日历事件');
    }
    return event;
  }
}

@Controller()
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get('calendar')
  list(@Query() query: CalendarRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query.start, query.end, user);
  }

  @Post('calendar-events')
  create(@Body() dto: CreateCalendarEventDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('calendar-events/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('calendar-events/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEvent,
      Menu,
      HouseholdMedia,
      Visit,
      MaintenancePlan,
      TravelPlan,
    ]),
    TasksModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
