import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AssetCategory,
  AssetDocumentType,
  AssetRenewalIntervalMonths,
  AssetStatus,
} from '../entities';

const ASSET_CATEGORIES: AssetCategory[] = [
  'appliance',
  'furniture',
  'electronics',
  'tool',
  'subscription',
  'other',
];

const RENEWAL_INTERVALS: AssetRenewalIntervalMonths[] = [1, 3, 6, 12];

const DOCUMENT_TYPES: AssetDocumentType[] = [
  'receipt',
  'manual',
  'warranty',
  'other',
];

export class AssetListQueryDto {
  @IsOptional()
  @IsIn(['active', 'retired', 'all'])
  status?: AssetStatus | 'all';

  @IsOptional()
  @IsIn(ASSET_CATEGORIES)
  category?: AssetCategory;
}

export class CreateAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsIn(ASSET_CATEGORIES)
  category: AssetCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string | null;

  /** I1：位置字典里的位置；给了非空值时旧文本一并清掉 */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  purchasePrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  warrantyExpiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  renewsOn?: string | null;

  @IsOptional()
  @IsIn(RENEWAL_INTERVALS)
  renewalIntervalMonths?: AssetRenewalIntervalMonths | null;

  /** 只对 subscription 生效；空时按购买价格算续费月均 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  renewalPrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(ASSET_CATEGORIES)
  category?: AssetCategory;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  location?: string | null;

  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  purchaseDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  purchasePrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  warrantyExpiresOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  renewsOn?: string | null;

  @IsOptional()
  @IsIn(RENEWAL_INTERVALS)
  renewalIntervalMonths?: AssetRenewalIntervalMonths | null;

  /** 只对 subscription 生效；空时按购买价格算续费月均 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  renewalPrice?: number | null;

  @IsOptional()
  @IsIn(['active', 'retired'])
  status?: AssetStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class RenewSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  renewedOn?: string;
}

export class CreateAssetDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: AssetDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url: string;
}

export class UploadAssetDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: AssetDocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;
}

export class CreateMaintenancePlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsInt()
  @Min(1)
  @Max(3650)
  frequencyDays: number;

  @IsString()
  @MaxLength(10)
  nextDueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateMaintenancePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  frequencyDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  nextDueDate?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class CompleteMaintenanceDto {
  /** 用户认定的完成日（家庭日期）；完成时刻 performedAt 由服务端记当前时间。 */
  @IsString()
  performedOn: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  cost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  consumeInventory?: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idempotencyKey: string;
}

export class CreateMaintenanceConsumableDto {
  @IsUUID()
  inventoryItemId: string;

  @IsNumber()
  @Min(0.01)
  @Max(99_999_999.99)
  quantity: number;
}

export class UpdateMaintenanceConsumableDto {
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(99_999_999.99)
  quantity?: number;
}

export class AddMaintenanceShoppingDto {
  @IsISO8601({ strict: true })
  date: string;
}

export class SetAssetLocationDto {
  @IsOptional()
  @IsUUID()
  locationId: string | null;
}
