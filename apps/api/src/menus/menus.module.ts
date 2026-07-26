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
import { Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { MealType, Menu, MenuItem, MenuItemStatus } from '../entities';

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

@Injectable()
export class MenusService {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuItem) private readonly items: Repository<MenuItem>,
  ) {}

  async findOrCreate(date: string, mealType: MealType) {
    let menu = await this.menus.findOne({
      where: { date, mealType },
      relations: { items: true },
      order: { items: { createdAt: 'ASC' } },
    });
    if (!menu) {
      menu = await this.menus.save(this.menus.create({ date, mealType }));
      menu.items = [];
    }
    return menu;
  }

  async listByDate(date: string) {
    const lunch = await this.findOrCreate(date, 'lunch');
    const dinner = await this.findOrCreate(date, 'dinner');
    return [lunch, dinner];
  }

  async addItems(menuId: string, dto: AddItemsDto, userId: string) {
    const menu = await this.menus.findOneBy({ id: menuId });
    if (!menu) throw new NotFoundException('菜单不存在');
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
    return this.findOrCreate(menu.date, menu.mealType);
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    const item = await this.items.findOneBy({ id });
    if (!item) throw new NotFoundException('这道菜不在菜单里');
    Object.assign(item, dto);
    return this.items.save(item);
  }
}

@Controller()
export class MenusController {
  constructor(private readonly service: MenusService) {}

  // GET /menus?date=2026-07-26 → [午餐, 晚餐]；带 mealType 只返回一个
  @Get('menus')
  async get(
    @Query('date') date: string,
    @Query('mealType') mealType?: MealType,
  ) {
    if (!date) throw new NotFoundException('date 必填 (YYYY-MM-DD)');
    if (mealType) return this.service.findOrCreate(date, mealType);
    return this.service.listByDate(date);
  }

  @Post('menus/:id/items')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addItems(id, dto, user.sub);
  }

  @Patch('menu-items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.service.updateItem(id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Menu, MenuItem])],
  controllers: [MenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
