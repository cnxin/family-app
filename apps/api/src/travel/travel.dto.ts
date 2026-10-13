import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { TravelChecklistCategory } from '../entities';

const TRAVEL_CATEGORIES: TravelChecklistCategory[] = [
  'documents',
  'clothing',
  'toiletries',
  'electronics',
  'supplies',
  'other',
];

export class TravelListQueryDto {
  @IsOptional()
  @IsIn(['active', 'completed', 'cancelled', 'archived', 'all'])
  status?: 'active' | 'completed' | 'cancelled' | 'archived' | 'all';
}

export class TravelTemplateListQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';
}

export class CreateTravelPlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UpdateTravelPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class TravelVersionOperationDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class CreateTravelItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsIn(TRAVEL_CATEGORIES)
  category: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsUUID()
  assignedMemberId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UpdateTravelItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(TRAVEL_CATEGORIES)
  category?: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsUUID()
  assignedMemberId?: string | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class TravelItemVersionOperationDto extends TravelVersionOperationDto {}

export class TravelTemplateItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsIn(TRAVEL_CATEGORIES)
  category: TravelChecklistCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
}

export class CreateTravelTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TravelTemplateItemDto)
  items: TravelTemplateItemDto[];

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UpdateTravelTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TravelTemplateItemDto)
  items?: TravelTemplateItemDto[];

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class ApplyTravelTemplateDto {
  @IsInt()
  @Min(1)
  expectedPlanVersion: number;

  @IsInt()
  @Min(1)
  expectedTemplateVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}
