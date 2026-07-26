import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Dish, DishCategory, DishIngredient, Ingredient } from '../entities';

class DishIngredientDto {
  @IsOptional()
  @IsString()
  ingredientId?: string;

  // 传 name 时按名称 find-or-create 食材
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  quantity: number;

  @IsString()
  unit: string;
}

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DishIngredientDto)
  ingredients?: DishIngredientDto[];
}

@Injectable()
export class DishesService {
  constructor(
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
    @InjectRepository(Ingredient) private readonly ingredients: Repository<Ingredient>,
    @InjectRepository(DishIngredient)
    private readonly dishIngredients: Repository<DishIngredient>,
  ) {}

  list() {
    return this.dishes.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  listIngredients() {
    return this.ingredients.find({ order: { category: 'ASC', name: 'ASC' } });
  }

  private async resolveIngredient(dto: DishIngredientDto): Promise<Ingredient> {
    if (dto.ingredientId) {
      const found = await this.ingredients.findOneBy({ id: dto.ingredientId });
      if (!found) throw new NotFoundException(`食材不存在: ${dto.ingredientId}`);
      return found;
    }
    if (!dto.name) throw new NotFoundException('食材需要 ingredientId 或 name');
    const existing = await this.ingredients.findOneBy({ name: dto.name });
    if (existing) return existing;
    return this.ingredients.save(
      this.ingredients.create({
        name: dto.name,
        category: (dto.category as Ingredient['category']) || '其他',
        defaultUnit: dto.unit,
      }),
    );
  }

  private async buildIngredients(dish: Dish, items: DishIngredientDto[]) {
    await this.dishIngredients.delete({ dishId: dish.id });
    for (const item of items) {
      const ingredient = await this.resolveIngredient(item);
      await this.dishIngredients.save(
        this.dishIngredients.create({
          dishId: dish.id,
          ingredientId: ingredient.id,
          quantity: String(item.quantity),
          unit: item.unit,
        }),
      );
    }
  }

  async create(dto: UpsertDishDto, userId: string) {
    if (!dto.name) throw new NotFoundException('菜名必填');
    const { ingredients, ...fields } = dto;
    const dish = await this.dishes.save(
      this.dishes.create({ ...fields, name: dto.name, createdBy: userId }),
    );
    if (ingredients?.length) await this.buildIngredients(dish, ingredients);
    return this.get(dish.id);
  }

  async get(id: string) {
    const dish = await this.dishes.findOneBy({ id });
    if (!dish) throw new NotFoundException('菜品不存在');
    return dish;
  }

  async update(id: string, dto: UpsertDishDto) {
    const dish = await this.get(id);
    const { ingredients, ...fields } = dto;
    Object.assign(dish, fields);
    await this.dishes.save(dish);
    if (ingredients) await this.buildIngredients(dish, ingredients);
    return this.get(id);
  }

  async remove(id: string) {
    const dish = await this.get(id);
    dish.isActive = false;
    await this.dishes.save(dish);
    return { id, removed: true };
  }
}

@Controller()
export class DishesController {
  constructor(private readonly service: DishesService) {}

  @Get('dishes')
  list() {
    return this.service.list();
  }

  @Get('ingredients')
  listIngredients() {
    return this.service.listIngredients();
  }

  @Post('dishes')
  create(@Body() dto: UpsertDishDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user.sub);
  }

  @Patch('dishes/:id')
  update(@Param('id') id: string, @Body() dto: UpsertDishDto) {
    return this.service.update(id, dto);
  }

  @Delete('dishes/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Dish, Ingredient, DishIngredient])],
  controllers: [DishesController],
  providers: [DishesService],
})
export class DishesModule {}
