import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MealType, MenuItemStatus } from '../entities';

export class OrderItemDto {
  @IsUUID()
  dishId: string;

  @IsOptional()
  @IsUUID()
  recipeVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class AddItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export class UpdateItemDto {
  @IsOptional()
  @IsIn(['pending', 'accepted', 'cooking', 'done', 'rejected'])
  status?: MenuItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsUUID()
  recipeVariantId?: string;
}

export class AssignChefDto {
  @IsOptional()
  @IsUUID()
  chefId?: string | null;
}

export class MenuDateRangeDto {
  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}

export class MenuQueryDto {
  @IsISO8601()
  date: string;

  @IsOptional()
  @IsIn(['breakfast', 'lunch', 'dinner'])
  mealType?: MealType;
}
