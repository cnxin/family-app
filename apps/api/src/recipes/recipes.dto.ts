import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DishSkillLevel } from '../entities';

export class VariantIngredientDto {
  @IsOptional()
  @IsUUID()
  ingredientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsString()
  @MaxLength(32)
  unit: string;
}

class VariantStepDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;
}

class VariantLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsString()
  @MaxLength(1000)
  url: string;
}

export class UpsertRecipeVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  authorMemberId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  estMinutes?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantIngredientDto)
  ingredients?: VariantIngredientDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantStepDto)
  steps?: VariantStepDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantLinkDto)
  referenceLinks?: VariantLinkDto[];
}

export class UpsertDishSkillDto {
  @IsUUID()
  dishId: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  preferredRecipeId?: string | null;

  @IsOptional()
  @IsIn(['learning', 'can_cook', 'signature'])
  level?: DishSkillLevel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
