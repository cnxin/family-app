import {
  Body,
  ConflictException,
  Controller,
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
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { DataSource, In, Not, Repository } from 'typeorm';
import { assertCapability, RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Dish, MealType, Menu, MenuItem, MenuItemStatus } from '../entities';

class OrderItemDto {
  @IsUUID()
  dishId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class AddItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

class UpdateItemDto {
  @IsOptional()
  @IsIn(['pending', 'accepted', 'cooking', 'done', 'rejected'])
  status?: MenuItemStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

class MenuDateRangeDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}

class MenuQueryDto {
  @IsISO8601()
  date: string;

  @IsOptional()
  @IsIn(['breakfast', 'lunch', 'dinner'])
  mealType?: MealType;
}

const ALLOWED_STATUS_TRANSITIONS: Record<
  MenuItemStatus,
  readonly MenuItemStatus[]
> = {
  pending: ['accepted', 'rejected'],
  accepted: ['cooking', 'rejected'],
  cooking: ['done'],
  done: [],
  rejected: ['pending'],
};

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

@Injectable()
export class MenusService {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuItem) private readonly items: Repository<MenuItem>,
    private readonly dataSource: DataSource,
  ) {}

  async findOrCreate(householdId: string, date: string, mealType: MealType) {
    let menu = await this.menus.findOne({
      where: { householdId, date, mealType },
      relations: { items: true },
      order: { items: { createdAt: 'ASC' } },
    });
    if (!menu) {
      await this.menus
        .createQueryBuilder()
        .insert()
        .values({ householdId, date, mealType })
        .orIgnore()
        .execute();
      menu = await this.menus.findOne({
        where: { householdId, date, mealType },
        relations: { items: true },
        order: { items: { createdAt: 'ASC' } },
      });
      if (!menu) throw new ConflictException('菜单创建失败，请重试');
    }
    return menu;
  }

  async listByDate(householdId: string, date: string) {
    const breakfast = await this.findOrCreate(householdId, date, 'breakfast');
    const lunch = await this.findOrCreate(householdId, date, 'lunch');
    const dinner = await this.findOrCreate(householdId, date, 'dinner');
    return [breakfast, lunch, dinner];
  }

  async listDateCounts(householdId: string, start: string, end: string) {
    const rows = await this.items
      .createQueryBuilder('item')
      .innerJoin('item.menu', 'menu')
      .select('menu.date', 'date')
      .addSelect('COUNT(item.id)', 'count')
      .where('menu.date >= :start', { start })
      .andWhere('menu.date <= :end', { end })
      .andWhere('menu.householdId = :householdId', { householdId })
      .andWhere('item.status != :rejected', { rejected: 'rejected' })
      .groupBy('menu.date')
      .orderBy('menu.date', 'ASC')
      .getRawMany<{ date: string | Date; count: string }>();

    return rows.map((row) => ({
      date:
        row.date instanceof Date
          ? row.date.toISOString().slice(0, 10)
          : String(row.date).slice(0, 10),
      count: Number(row.count),
    }));
  }

  async addItems(
    menuId: string,
    dto: AddItemsDto,
    householdId: string,
    userId: string,
  ) {
    let menuDate = '';
    let menuMealType: MealType = 'dinner';
    try {
      await this.dataSource.transaction(async (manager) => {
        const menus = manager.getRepository(Menu);
        const items = manager.getRepository(MenuItem);
        const dishes = manager.getRepository(Dish);
        const menu = await menus.findOneBy({ id: menuId, householdId });
        if (!menu) throw new NotFoundException('菜单不存在');
        menuDate = menu.date;
        menuMealType = menu.mealType;

        const dishIds = [...new Set(dto.items.map((item) => item.dishId))];
        if (dishIds.length !== dto.items.length) {
          throw new ConflictException('一次点菜中不能重复选择同一道菜');
        }
        const dishCount = await dishes.countBy({
          id: In(dishIds),
          householdId,
        });
        if (dishCount !== dishIds.length) {
          throw new NotFoundException('菜品不存在');
        }

        const existing = await items.findOne({
          where: {
            menuId,
            dishId: In(dishIds),
            requestedById: userId,
            status: Not('rejected'),
          },
        });
        if (existing) {
          throw new ConflictException('这餐已经点过所选菜品，请勿重复提交');
        }

        await items.save(
          dto.items.map((item) =>
            items.create({
              menuId,
              dishId: item.dishId,
              requestedById: userId,
              note: item.note ?? null,
            }),
          ),
        );
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) {
        throw new ConflictException('这餐已经点过所选菜品，请勿重复提交');
      }
      throw error;
    }
    return this.findOrCreate(householdId, menuDate, menuMealType);
  }

  async updateItem(id: string, dto: UpdateItemDto, user: JwtUser) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const items = manager.getRepository(MenuItem);
        const item = await items
          .createQueryBuilder('item')
          .innerJoin('item.menu', 'menu')
          .where('item.id = :id', { id })
          .andWhere('menu.householdId = :householdId', {
            householdId: user.householdId,
          })
          .setLock('pessimistic_write')
          .getOne();
        if (!item) throw new NotFoundException('这道菜不在菜单里');

        if (dto.status != null) {
          assertCapability(user, 'update_meal_status');
          if (
            dto.status !== item.status &&
            !ALLOWED_STATUS_TRANSITIONS[item.status].includes(dto.status)
          ) {
            throw new ConflictException(
              `不能从「${item.status}」直接变更为「${dto.status}」`,
            );
          }
          item.status = dto.status;
        }
        if (dto.note != null) {
          if (item.requestedById !== user.memberId) {
            throw new ForbiddenException('只能修改自己点菜的备注');
          }
          item.note = dto.note;
        }
        await items.save(item);
        const saved = await items.findOne({ where: { id } });
        if (!saved) throw new NotFoundException('这道菜不在菜单里');
        return saved;
      });
    } catch (error) {
      if (dto.status === 'pending' && isUniqueViolation(error)) {
        throw new ConflictException('已经重新点过这道菜，无需恢复旧记录');
      }
      throw error;
    }
  }
}

@Controller()
export class MenusController {
  constructor(private readonly service: MenusService) {}

  @Get('menu-dates')
  dateCounts(@Query() query: MenuDateRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.listDateCounts(user.householdId, query.start, query.end);
  }

  // GET /menus?date=2026-07-26 -> [早餐, 午餐, 晚餐]；带 mealType 只返回一个
  @Get('menus')
  async get(@CurrentUser() user: JwtUser, @Query() query: MenuQueryDto) {
    if (query.mealType) {
      return this.service.findOrCreate(
        user.householdId,
        query.date,
        query.mealType,
      );
    }
    return this.service.listByDate(user.householdId, query.date);
  }

  @Post('menus/:id/items')
  @RequireCapabilities('place_meal_order')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addItems(id, dto, user.householdId, user.sub);
  }

  @Patch('menu-items/:id')
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateItem(id, dto, user);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Menu, MenuItem])],
  controllers: [MenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
