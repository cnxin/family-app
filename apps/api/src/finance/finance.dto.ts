import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FinanceAccountType, FinanceCategoryKind, FinanceTransactionType } from '../entities';
import { MAX_AMOUNT } from './finance.helpers';

const ACCOUNT_TYPES: FinanceAccountType[] = [
  'cash',
  'bank',
  'alipay',
  'wechat',
  'other',
  'credit',
];

const TRANSACTION_TYPES: Exclude<FinanceTransactionType, 'reversal'>[] = [
  'expense',
  'income',
  'transfer',
];

export class FinanceMonthQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class FinanceTransactionQueryDto extends FinanceMonthQueryDto {
  @IsOptional()
  @IsIn(['expense', 'income', 'transfer', 'reversal'])
  type?: FinanceTransactionType;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** K5：名称 / 商户 / 备注里找 */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** 谁记的（actorId） */
  @IsOptional()
  @IsUUID()
  memberId?: string;

  /** 连已删除、已改过（被替代）的一起列 */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeDeleted?: 'true' | 'false';
}

export class CreateFinanceAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsIn(ACCOUNT_TYPES)
  type: FinanceAccountType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  openingBalance?: number;

  /** K4：只有信用卡能填，见 FinanceService.creditFields */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  creditLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;
}

export class UpdateFinanceAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(ACCOUNT_TYPES)
  type?: FinanceAccountType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** K4：只有信用卡能填，见 FinanceService.creditFields */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  creditLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class CreateFinanceCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsIn(['expense', 'income'])
  kind: FinanceCategoryKind;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;
}

export class UpdateFinanceCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

export class CreateFinanceTransactionDto {
  @IsIn(TRANSACTION_TYPES)
  type: Exclude<FinanceTransactionType, 'reversal'>;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurredOn: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;

  /** K2：截图识别出的交易对方 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string | null;

  /** K2：截图识别返回的文件名（uuid + .jpg / .png / .webp） */
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/)
  attachmentPath?: string | null;
}

export class ReverseFinanceTransactionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

export class UpsertFinanceBudgetDto {
  @IsUUID()
  categoryId: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  amount: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class DeleteFinanceBudgetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;
}
