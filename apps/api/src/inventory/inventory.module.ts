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
  MaxLength,
  Min,
} from 'class-validator';
import { Repository } from 'typeorm';
import { InventoryCategory, InventoryItem } from '../entities';

const INVENTORY_CATEGORIES: InventoryCategory[] = [
  '调料',
  '主食',
  '饮料',
  '零食',
  '日用品',
  '其他',
];

class CreateInventoryItemDto {
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
  ) {}

  list() {
    return this.items.find({ order: { category: 'ASC', name: 'ASC' } });
  }

  async create(dto: CreateInventoryItemDto) {
    const name = dto.name.trim();
    if (await this.items.findOneBy({ name })) {
      throw new ConflictException(`库存中已经有「${name}」`);
    }
    return this.items.save(
      this.items.create({
        ...dto,
        name,
        unit: dto.unit.trim(),
        quantity: String(dto.quantity),
        lowStockThreshold: String(dto.lowStockThreshold),
        restockQuantity: String(dto.restockQuantity),
      }),
    );
  }

  async update(id: string, dto: UpdateInventoryItemDto) {
    const item = await this.items.findOneBy({ id });
    if (!item) throw new NotFoundException('库存项不存在');

    if (dto.name != null) {
      const name = dto.name.trim();
      const duplicate = await this.items.findOneBy({ name });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`库存中已经有「${name}」`);
      }
      item.name = name;
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
    return this.items.save(item);
  }

  async remove(id: string) {
    const result = await this.items.delete(id);
    if (!result.affected) throw new NotFoundException('库存项不存在');
    return { id, removed: true };
  }
}

@Controller()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('inventory')
  list() {
    return this.service.list();
  }

  @Post('inventory-items')
  create(@Body() dto: CreateInventoryItemDto) {
    return this.service.create(dto);
  }

  @Patch('inventory-items/:id')
  update(@Param('id') id: string, @Body() dto: UpdateInventoryItemDto) {
    return this.service.update(id, dto);
  }

  @Delete('inventory-items/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem])],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
