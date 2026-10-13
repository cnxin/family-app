import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FamilyMemoryCategory, FamilyMemorySourceModule } from '../entities';

const MEMORY_CATEGORIES: FamilyMemoryCategory[] = [
  'daily',
  'celebration',
  'travel',
  'meal',
  'visit',
  'milestone',
  'other',
];

const MEMORY_SOURCE_MODULES: FamilyMemorySourceModule[] = [
  'calendar',
  'travel',
  'menu',
  'media',
  'visit',
];

export class MemoryListQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';

  @IsOptional()
  @IsIn(MEMORY_CATEGORIES)
  category?: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class CreateMemoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  happenedOn: string;

  @IsIn(MEMORY_CATEGORIES)
  category: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  story?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(MEMORY_SOURCE_MODULES)
  sourceModule?: FamilyMemorySourceModule | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UpdateMemoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  happenedOn?: string;

  @IsOptional()
  @IsIn(MEMORY_CATEGORIES)
  category?: FamilyMemoryCategory;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  story?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(MEMORY_SOURCE_MODULES)
  sourceModule?: FamilyMemorySourceModule | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class MemoryVersionOperationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UploadMemoryPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  caption?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}
