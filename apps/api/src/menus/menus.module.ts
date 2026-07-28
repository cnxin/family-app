import {
  Body,
  Controller,
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
import { In, Repository } from 'typeorm';
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

@Injectable()
export class MenusService {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuItem) private readonly items: Repository<MenuItem>,
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
  ) {}

  async findOrCreate(householdId: string, date: string, mealType: MealType) {
    let menu = await this.menus.findOne({
      where: { householdId, date, mealType },
      relations: { items: true },
      order: { items: { createdAt: 'ASC' } },
    });
    if (!menu) {
      menu = await this.menus.save(
        this.menus.create({ householdId, date, mealType }),
      );
      menu.items = [];
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
    const menu = await this.menus.findOneBy({ id: menuId, householdId });
    if (!menu) throw new NotFoundException('菜单不存在');

    const dishIds = [...new Set(dto.items.map((item) => item.dishId))];
    const dishCount = await this.dishes.countBy({
      id: In(dishIds),
      householdId,
    });
    if (dishCount !== dishIds.length) {
      throw new NotFoundException('菜品不存在');
    }

    for (const item of dto.items) {
      await this.items.save(
        this.items.create({
          menuId,
          dishId: item.dishId,
          requestedById: userId,
          note: item.note ?? null,
        }),
      );
    }
    return this.findOrCreate(householdId, menu.date, menu.mealType);
  }

  async updateItem(id: string, dto: UpdateItemDto, householdId: string) {
    const item = await this.items.findOne({
      where: { id, menu: { householdId } },
    });
    if (!item) throw new NotFoundException('这道菜不在菜单里');
    Object.assign(item, dto);
    return this.items.save(item);
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
  async get(
    @CurrentUser() user: JwtUser,
    @Query('date') date: string,
    @Query('mealType') mealType?: MealType,
  ) {
    if (!date) throw new NotFoundException('date 必填 (YYYY-MM-DD)');
    if (mealType) return this.service.findOrCreate(user.householdId, date, mealType);
    return this.service.listByDate(user.householdId, date);
  }

  @Post('menus/:id/items')
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
    return this.service.updateItem(id, dto, user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Menu, MenuItem, Dish])],
  controllers: [MenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
