import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InventoryCategory } from '../entities';
import { BatchDatesInput } from './inventory-batches.service';

const INVENTORY_CATEGORIES: InventoryCategory[] = [
  '调料',
  '主食',
  '饮料',
  '零食',
  '日用品',
  '药品',
  '其他',
];

export class CreateInventoryItemDto {
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

  /** I1：默认位置 / 放哪儿；不填不拦 */
  @IsOptional()
  @IsUUID()
  defaultLocationId?: string | null;
}

export class UpdateInventoryItemDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  /** I1：默认位置 / 放哪儿；不填不拦 */
  @IsOptional()
  @IsUUID()
  defaultLocationId?: string | null;
}

export class InventoryTransactionsQueryDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class InventoryBatchesQueryDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsOptional()
  @IsIn(['all', 'active', 'expiring', 'expired'])
  status?: 'all' | 'active' | 'expiring' | 'expired';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

class BatchDatesDto implements BatchDatesInput {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  receivedOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  productionDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  expiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  openedOn?: string | null;
}

export class CreateInventoryBatchDto extends BatchDatesDto {
  @IsUUID()
  inventoryItemId: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey: string;

  /** I1：默认位置 / 放哪儿；不填不拦 */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
}

export class UpdateInventoryBatchDto extends BatchDatesDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class ShoppingInventoryPreviewDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;
}

export class ConfirmShoppingReceiptDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BatchDatesDto)
  batch?: BatchDatesDto;

  /** I1：默认位置 / 放哪儿；不填不拦 */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
}

export class SetLocationDto {
  @IsOptional()
  @IsUUID()
  locationId: string | null;
}
