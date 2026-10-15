import {
  FinanceAttention,
  FinanceBudgetAttentionRule,
  FinanceCreditDueProvider,
  FinanceRecurringDueProvider,
  FinanceRecurringFailedProvider,
} from './finance-attention';
import { TodayModule } from '../today/today.module';
import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceImport,
  FinanceMerchantRule,
  FinancePosting,
  FinanceRecurring,
  FinanceTransaction,
} from '../entities';
import { FinanceScreenshotModule } from './finance-screenshot.controller';
import { FinanceService } from './finance.service';
import { FinanceAccountsService } from './finance-accounts.service';
import { FinanceBudgetsService } from './finance-budgets.service';
import { financeFacade } from './finance.facade';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { FinanceEditController, FinanceEditService } from './finance-edit.service';
import { FinanceImportController } from './finance-import.controller';
import { FinanceImportService } from './finance-import.service';
import { FinanceRecurringScheduler } from './finance-recurring.scheduler';
import { FinanceRecurringController } from './finance-recurring.controller';
import { FinanceRecurringService } from './finance-recurring.service';
import { FinanceController } from './finance.controller';

export { FinanceService } from './finance.service';

/** 把财务门面注册到内核（J4.1）：小管家读账本汇总、记账提案的预览与确认后入账走这里。 */
@Injectable()
export class FinanceFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly finance: FinanceService,
    private readonly budgets: FinanceBudgetsService,
  ) {}

  onModuleInit() {
    this.registry.register('finance', financeFacade(this.finance, this.budgets));
  }
}

@Module({
  imports: [
    TodayModule,
    // K2 截图记账（用内核的云端看图）
    FinanceScreenshotModule,
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
    FinanceAccountsService,
    FinanceBudgetsService,
    FinanceEditService,
    FinanceImportService,
    FinanceRecurringService,
    FinanceRecurringScheduler,
    FinanceBudgetAttentionRule,
    FinanceRecurringDueProvider,
    FinanceCreditDueProvider,
    FinanceRecurringFailedProvider,
    FinanceAttention,
    FinanceFacadeProvider,
  ],
  exports: [FinanceService],
})
export class FinanceModule {}
