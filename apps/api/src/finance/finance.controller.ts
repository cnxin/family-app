import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { FinanceService } from './finance.service';
import { FinanceAccountsService } from './finance-accounts.service';
import { FinanceBudgetsService } from './finance-budgets.service';
import {
  FinanceMonthQueryDto,
  FinanceTransactionQueryDto,
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
  CreateFinanceCategoryDto,
  UpdateFinanceCategoryDto,
  CreateFinanceTransactionDto,
  ReverseFinanceTransactionDto,
  UpsertFinanceBudgetDto,
  DeleteFinanceBudgetDto,
} from './finance.dto';

@Controller('finance')
@RequireCapabilities('view_finance')
export class FinanceController {
  constructor(
    private readonly service: FinanceService,
    private readonly accountsService: FinanceAccountsService,
    private readonly budgetsService: FinanceBudgetsService,
  ) {}

  @Get('summary')
  summary(@Query() query: FinanceMonthQueryDto, @CurrentUser() user: JwtUser) {
    return this.budgetsService.summary(query.month, user);
  }

  @Get('accounts')
  accounts(
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.accountsService.listAccounts(user, includeInactive === 'true');
  }

  @Post('accounts')
  @RequireCapabilities('manage_finance')
  createAccount(@Body() dto: CreateFinanceAccountDto, @CurrentUser() user: JwtUser) {
    return this.accountsService.createAccount(dto, user);
  }

  @Patch('accounts/:id')
  @RequireCapabilities('manage_finance')
  updateAccount(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceAccountDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.accountsService.updateAccount(id, dto, user);
  }

  @Get('categories')
  categories(
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.accountsService.listCategories(user, includeInactive === 'true');
  }

  @Post('categories')
  @RequireCapabilities('manage_finance')
  createCategory(@Body() dto: CreateFinanceCategoryDto, @CurrentUser() user: JwtUser) {
    return this.accountsService.createCategory(dto, user);
  }

  @Patch('categories/:id')
  @RequireCapabilities('manage_finance')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceCategoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.accountsService.updateCategory(id, dto, user);
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
    return this.budgetsService.listBudgets(query.month, user);
  }

  @Put('budgets')
  @RequireCapabilities('manage_finance')
  upsertBudget(@Body() dto: UpsertFinanceBudgetDto, @CurrentUser() user: JwtUser) {
    return this.budgetsService.upsertBudget(dto, user);
  }

  @Delete('budgets/:id')
  @RequireCapabilities('manage_finance')
  deleteBudget(
    @Param('id') id: string,
    @Query() query: DeleteFinanceBudgetDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.budgetsService.deleteBudget(id, query, user);
  }
}
