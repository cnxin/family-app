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
import { CalendarEvent, MealType, Menu } from '../entities';

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

function parseDateOnly(value: string, fieldName: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${fieldName}必须使用 YYYY-MM-DD 格式`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${fieldName}不是有效日期`);
  }
  return timestamp;
}

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

    const [events, menuRows] = await Promise.all([
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
    ];

    return rows.sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date);
      if (dateOrder) return dateOrder;
      if (left.module !== right.module) return left.module === 'calendar' ? -1 : 1;
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
  imports: [TypeOrmModule.forFeature([CalendarEvent, Menu])],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
