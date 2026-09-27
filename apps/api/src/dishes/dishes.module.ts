import {
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
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishCategory,
  DishRecipeVariant,
  Ingredient,
} from '../entities';

class UpsertDishDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['荤菜', '素菜', '汤', '主食', '甜品'])
  category?: DishCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  difficulty?: number;

  @IsOptional()
  @IsInt()
  estMinutes?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class DishesService {
  constructor(
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
    @InjectRepository(Ingredient) private readonly ingredients: Repository<Ingredient>,
    private readonly dataSource: DataSource,
  ) {}

  list(householdId: string) {
    return this.dishes.find({
      where: { householdId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  listIngredients(householdId: string) {
    return this.ingredients.find({
      where: { householdId },
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  private async syncDefaultRecipe(
    dish: Dish,
    dto: UpsertDishDto,
    householdId: string,
    manager: EntityManager,
  ) {
    const variants = manager.getRepository(DishRecipeVariant);
    let variant = await variants.findOneBy({
      householdId,
      dishId: dish.id,
      isDefault: true,
      isArchived: false,
    });
    const isNew = !variant;
    if (!variant) {
      variant = variants.create({
        householdId,
        dishId: dish.id,
        authorMemberId: null,
        name: '家庭默认',
        isDefault: true,
        isArchived: false,
        note: dish.note,
        estMinutes: dish.estMinutes,
      });
    }
    if (dto.note !== undefined || isNew) variant.note = dish.note;
    if (dto.estMinutes !== undefined || isNew) {
      variant.estMinutes = dish.estMinutes;
    }
    await variants.save(variant);
  }

  async create(dto: UpsertDishDto, householdId: string, userId: string) {
    if (!dto.name) throw new NotFoundException('菜名必填');
    return this.dataSource.transaction(async (manager) => {
      const dishes = manager.getRepository(Dish);
      const dish = await dishes.save(
        dishes.create({
          ...dto,
          householdId,
          name: dto.name!,
          createdBy: userId,
        }),
      );
      await this.syncDefaultRecipe(dish, dto, householdId, manager);
      const saved = await dishes.findOneBy({ id: dish.id, householdId });
      if (!saved) throw new NotFoundException('菜品不存在');
      return saved;
    });
  }

  async get(id: string, householdId: string) {
    const dish = await this.dishes.findOneBy({ id, householdId });
    if (!dish) throw new NotFoundException('菜品不存在');
    return dish;
  }

  async update(id: string, dto: UpsertDishDto, householdId: string) {
    return this.dataSource.transaction(async (manager) => {
      const dishes = manager.getRepository(Dish);
      const dish = await dishes
        .createQueryBuilder('dish')
        .where('dish.id = :id', { id })
        .andWhere('dish.householdId = :householdId', { householdId })
        .setLock('pessimistic_write')
        .getOne();
      if (!dish) throw new NotFoundException('菜品不存在');
      Object.assign(dish, dto);
      await dishes.save(dish);
      await this.syncDefaultRecipe(dish, dto, householdId, manager);
      const saved = await dishes.findOneBy({ id, householdId });
      if (!saved) throw new NotFoundException('菜品不存在');
      return saved;
    });
  }

  async remove(id: string, householdId: string) {
    const dish = await this.get(id, householdId);
    dish.isActive = false;
    await this.dishes.save(dish);
    return { id, removed: true };
  }
}

@Controller()
export class DishesController {
  constructor(private readonly service: DishesService) {}

  @Get('dishes')
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user.householdId);
  }

  @Get('ingredients')
  listIngredients(@CurrentUser() user: JwtUser) {
    return this.service.listIngredients(user.householdId);
  }

  @Post('dishes')
  @RequireCapabilities('manage_recipes')
  create(@Body() dto: UpsertDishDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user.householdId, user.sub);
  }

  @Patch('dishes/:id')
  @RequireCapabilities('manage_recipes')
  update(
    @Param('id') id: string,
    @Body() dto: UpsertDishDto,
    @CurrentUser() user: JwtUser,
  ) {
    const changesDefaultRecipe = ['note', 'estMinutes'].some((field) => Object.prototype.hasOwnProperty.call(dto, field));
    if (
      changesDefaultRecipe &&
      user.role !== 'owner' &&
      user.role !== 'admin'
    ) {
      throw new ForbiddenException('只有家庭管理员可以维护默认做法');
    }
    return this.service.update(id, dto, user.householdId);
  }

  @Delete('dishes/:id')
  @RequireCapabilities('manage_recipes')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Dish, Ingredient])],
  controllers: [DishesController],
  providers: [DishesService],
})
export class DishesModule {}
