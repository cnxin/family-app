import {
  FinanceAttention,
  FinanceBudgetAttentionRule,
  FinanceCreditDueProvider,
  FinanceRecurringDueProvider,
} from './finance-attention';
import { TodayModule } from '../today/today.module';
import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceImport,
  FinanceMerchantRule,
  FinancePosting,
  FinanceRecurring,
  FinanceTransaction,
  FinanceTransactionType,
} from '../entities';

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
import { FinanceService, MAX_AMOUNT } from './finance.service';
import { FinanceEditController, FinanceEditService } from './finance-edit.service';
import { FinanceImportController } from './finance-import.controller';
import { FinanceImportService } from './finance-import.service';
import { FinanceRecurringScheduler } from './finance-recurring.scheduler';
import { FinanceRecurringController, FinanceRecurringService } from './finance-recurring.service';

export { FinanceService } from './finance.service';

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

@Controller('finance')
@RequireCapabilities('view_finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  summary(@Query() query: FinanceMonthQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.summary(query.month, user);
  }

  @Get('accounts')
  accounts(
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listAccounts(user, includeInactive === 'true');
  }

  @Post('accounts')
  @RequireCapabilities('manage_finance')
  createAccount(@Body() dto: CreateFinanceAccountDto, @CurrentUser() user: JwtUser) {
    return this.service.createAccount(dto, user);
  }

  @Patch('accounts/:id')
  @RequireCapabilities('manage_finance')
  updateAccount(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceAccountDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateAccount(id, dto, user);
  }

  @Get('categories')
  categories(
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listCategories(user, includeInactive === 'true');
  }

  @Post('categories')
  @RequireCapabilities('manage_finance')
  createCategory(@Body() dto: CreateFinanceCategoryDto, @CurrentUser() user: JwtUser) {
    return this.service.createCategory(dto, user);
  }

  @Patch('categories/:id')
  @RequireCapabilities('manage_finance')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCategoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateCategory(id, dto, user);
  }

  @Get('transactions')
  transactions(@Query() query: FinanceTransactionQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.listTransactions(query, user);
  }

  @Post('transactions')
  @RequireCapabilities('record_finance')
  createTransaction(@Body() dto: CreateFinanceTransactionDto, @CurrentUser() user: JwtUser) {
    return this.service.createTransaction(dto, user);
  }

  @Post('transactions/:id/reverse')
  @RequireCapabilities('manage_finance')
  reverseTransaction(
    @Param('id') id: string,
    @Body() dto: ReverseFinanceTransactionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reverseTransaction(id, dto, user);
  }

  @Get('budgets')
  budgets(@Query() query: FinanceMonthQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.listBudgets(query.month, user);
  }

  @Put('budgets')
  @RequireCapabilities('manage_finance')
  upsertBudget(@Body() dto: UpsertFinanceBudgetDto, @CurrentUser() user: JwtUser) {
    return this.service.upsertBudget(dto, user);
  }

  @Delete('budgets/:id')
  @RequireCapabilities('manage_finance')
  deleteBudget(
    @Param('id') id: string,
    @Query() query: DeleteFinanceBudgetDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.deleteBudget(id, query, user);
  }
}

@Module({
  imports: [
    TodayModule,
    TypeOrmModule.forFeature([
      FinanceAccount,
      FinanceBudget,
      FinanceCategory,
      FinanceImport,
      FinanceMerchantRule,
      FinancePosting,
      FinanceRecurring,
      FinanceTransaction,
    ]),
  ],
  controllers: [FinanceController, FinanceRecurringController, FinanceImportController, FinanceEditController],
  providers: [
    FinanceService,
    FinanceEditService,
    FinanceImportService,
    FinanceRecurringService,
    FinanceRecurringScheduler,
    FinanceBudgetAttentionRule,
    FinanceRecurringDueProvider,
    FinanceCreditDueProvider,
    FinanceAttention,
  ],
  exports: [FinanceService],
})
export class FinanceModule {}
