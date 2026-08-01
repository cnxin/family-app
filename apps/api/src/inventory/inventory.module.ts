import {
  Body,
  ConflictException,
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
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Repository } from 'typeorm';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Ingredient, InventoryCategory, InventoryItem } from '../entities';

function isUniqueViolation(error: unknown) {
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

const INVENTORY_CATEGORIES: InventoryCategory[] = [
  '调料',
  '主食',
  '饮料',
  '零食',
  '日用品',
  '其他',
];

class CreateInventoryItemDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(INVENTORY_CATEGORIES)
  category: InventoryCategory;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit: string;

  @IsNumber()
  @Min(0)
  lowStockThreshold: number;

  @IsNumber()
  @Min(0.01)
  restockQuantity: number;
}

class UpdateInventoryItemDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(INVENTORY_CATEGORIES)
  category?: InventoryCategory;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  restockQuantity?: number;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private readonly items: Repository<InventoryItem>,
    @InjectRepository(Ingredient)
    private readonly ingredients: Repository<Ingredient>,
  ) {}

  list(householdId: string) {
    return this.items.find({
      where: { householdId },
      order: { category: 'ASC', name: 'ASC' },
    });
  }

  async create(dto: CreateInventoryItemDto, householdId: string) {
    const name = dto.name.trim();
    const unit = dto.unit.trim();
    if (await this.items.findOneBy({ householdId, name })) {
      throw new ConflictException(`库存中已经有「${name}」`);
    }
    if (dto.ingredientId) {
      await this.assertIngredient(dto.ingredientId, householdId);
      await this.assertUniqueIngredientUnit(
        dto.ingredientId,
        unit,
        householdId,
      );
    }
    return this.saveAndReload(
      this.items.create({
        ...dto,
        householdId,
        ingredientId: dto.ingredientId ?? null,
        name,
        unit,
        quantity: String(dto.quantity),
        lowStockThreshold: String(dto.lowStockThreshold),
        restockQuantity: String(dto.restockQuantity),
      }),
      householdId,
    );
  }

  async update(id: string, dto: UpdateInventoryItemDto, householdId: string) {
    const item = await this.items.findOneBy({ id, householdId });
    if (!item) throw new NotFoundException('库存项不存在');

    if (dto.name != null) {
      const name = dto.name.trim();
      const duplicate = await this.items.findOneBy({ householdId, name });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`库存中已经有「${name}」`);
      }
      item.name = name;
    }
    const nextIngredientId =
      dto.ingredientId === undefined ? item.ingredientId : dto.ingredientId;
    const nextUnit = dto.unit == null ? item.unit : dto.unit.trim();
    let nextIngredient: Ingredient | null = null;
    if (nextIngredientId) {
      nextIngredient = await this.assertIngredient(
        nextIngredientId,
        householdId,
      );
      await this.assertUniqueIngredientUnit(
        nextIngredientId,
        nextUnit,
        householdId,
        id,
      );
    }
    if (dto.ingredientId !== undefined) {
      item.ingredientId = dto.ingredientId;
      item.ingredient = nextIngredient;
    }
    if (dto.category != null) item.category = dto.category;
    if (dto.quantity != null) item.quantity = String(dto.quantity);
    if (dto.unit != null) item.unit = dto.unit.trim();
    if (dto.lowStockThreshold != null) {
      item.lowStockThreshold = String(dto.lowStockThreshold);
    }
    if (dto.restockQuantity != null) {
      item.restockQuantity = String(dto.restockQuantity);
    }
    return this.saveAndReload(item, householdId);
  }

  private async saveAndReload(item: InventoryItem, householdId: string) {
    try {
      await this.items.save(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('同名库存或食材单位关联已经存在');
      }
      throw error;
    }
    const saved = await this.items.findOneBy({ id: item.id, householdId });
    if (!saved) throw new NotFoundException('库存项不存在');
    return saved;
  }

  private async assertIngredient(ingredientId: string, householdId: string) {
    const ingredient = await this.ingredients.findOneBy({
      id: ingredientId,
      householdId,
    });
    if (!ingredient) throw new NotFoundException('关联食材不存在');
    return ingredient;
  }

  private async assertUniqueIngredientUnit(
    ingredientId: string,
    unit: string,
    householdId: string,
    currentId?: string,
  ) {
    const duplicate = await this.items.findOneBy({
      householdId,
      ingredientId,
      unit,
    });
    if (duplicate && duplicate.id !== currentId) {
      throw new ConflictException('这个食材和单位已经关联了库存');
    }
  }

  async remove(id: string, householdId: string) {
    const result = await this.items.delete({ id, householdId });
    if (!result.affected) throw new NotFoundException('库存项不存在');
    return { id, removed: true };
  }
}

@Controller()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('inventory')
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user.householdId);
  }

  @Post('inventory-items')
  @RequireCapabilities('manage_inventory')
  create(@Body() dto: CreateInventoryItemDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user.householdId);
  }

  @Patch('inventory-items/:id')
  @RequireCapabilities('manage_inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user.householdId);
  }

  @Delete('inventory-items/:id')
  @RequireCapabilities('manage_inventory')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem, Ingredient])],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
