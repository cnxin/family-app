import { monthRange } from '@family/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { FinanceBudget, FinanceCategory, FinanceTransaction, FinanceRecurring } from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { monthlyAverage } from './finance-recurring.schedule';
import type { DeleteFinanceBudgetDto, UpsertFinanceBudgetDto } from './finance.dto';
import { FinanceAccountsService } from './finance-accounts.service';
import { money } from './finance.helpers';
import { FinanceService } from './finance.service';

/** 预算与月度汇总：收支汇总、固定支出、预算增删查（J7.2 从 FinanceService 拆出）。 */
@Injectable()
export class FinanceBudgetsService {
  constructor(
    @InjectRepository(FinanceCategory)
    private readonly categories: Repository<FinanceCategory>,
    @InjectRepository(FinanceTransaction)
    private readonly transactions: Repository<FinanceTransaction>,
    @InjectRepository(FinanceBudget)
    private readonly budgets: Repository<FinanceBudget>,
    private readonly dataSource: DataSource,
    private readonly facades: PluginFacadeRegistry,
    private readonly accountsService: FinanceAccountsService,
    private readonly financeService: FinanceService,
  ) {}

  async summary(monthValue: string | undefined, user: JwtUser) {
    const month = (monthValue ?? (await this.financeService.today(user.householdId)).slice(0, 7));
    const { start, end } = monthRange(month);
    const [accounts, categories, budgets, spendingRows, totalsRows, fixedCosts] = await Promise.all([
      this.accountsService.listAccounts(user, true),
      this.accountsService.listCategories(user, true),
      this.budgets.find({ where: { householdId: user.householdId, month }, order: { createdAt: 'ASC' } }),
      this.transactions.query(
        `SELECT t."categoryId", COALESCE(SUM(t."amount"), 0) AS spent
         FROM "finance_transactions" t
         LEFT JOIN "finance_transactions" r ON r."reversalOfId" = t.id
         WHERE t."householdId" = $1 AND t.type = 'expense'
           AND t."occurredOn" >= $2 AND t."occurredOn" < $3 AND r.id IS NULL
           AND t."deletedAt" IS NULL AND t."supersededById" IS NULL
         GROUP BY t."categoryId"`,
        [user.householdId, start, end],
      ) as Promise<{ categoryId: string; spent: string }[]>,
      this.transactions.query(
        `SELECT t.type, COALESCE(SUM(t."amount"), 0) AS amount
         FROM "finance_transactions" t
         LEFT JOIN "finance_transactions" r ON r."reversalOfId" = t.id
         WHERE t."householdId" = $1 AND t.type IN ('expense', 'income')
           AND t."occurredOn" >= $2 AND t."occurredOn" < $3 AND r.id IS NULL
           AND t."deletedAt" IS NULL AND t."supersededById" IS NULL
         GROUP BY t.type`,
        [user.householdId, start, end],
      ) as Promise<{ type: 'expense' | 'income'; amount: string }[]>,
      this.fixedCosts(user.householdId),
    ]);
    const income = money(totalsRows.find((row) => row.type === 'income')?.amount);
    const expense = money(totalsRows.find((row) => row.type === 'expense')?.amount);
    const spending = new Map(spendingRows.map((row) => [row.categoryId, money(row.spent)]));
    const categoryMap = new Map(categories.map((category) => [category.id, category]));
    return {
      month,
      currency: 'CNY' as const,
      income,
      expense,
      net: money(income - expense),
      totalBalance: money(accounts.reduce((sum, account) => sum + account.balance, 0)),
      accounts,
      categories,
      budgets: budgets.map((budget) => {
        const spent = spending.get(budget.categoryId) ?? 0;
        const budgetAmount = money(budget.amount);
        return {
          ...budget,
          amount: budgetAmount,
          spent,
          remaining: money(budgetAmount - spent),
          ratio: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 1000) / 10 : 0,
          category: categoryMap.get(budget.categoryId) ?? budget.category,
        };
      }),
      categorySpending: spendingRows.map((row) => ({
        category: categoryMap.get(row.categoryId) ?? null,
        amount: money(row.spent),
      })),
      fixedCosts,
    };
  }

  /** 汇总页「固定支出」：在用的支出类周期账单折月均 + 资产续费月均（只能经资产门面读，J1b 规矩）。 */
  private async fixedCosts(householdId: string) {
    const [rules, assets] = await Promise.all([
      this.dataSource.getRepository(FinanceRecurring).find({
        where: { householdId, isActive: true, type: 'expense' },
        select: { id: true, amount: true, cadence: true },
      }),
      this.facades.get('assets').monthlyRecurringCost(householdId),
    ]);
    const recurring = money(rules.reduce((sum, rule) => sum + monthlyAverage(money(rule.amount), rule.cadence), 0));
    return { recurring, assets, total: money(recurring + assets) };
  }

  async listBudgets(monthValue: string | undefined, user: JwtUser) {
    const result = await this.summary(monthValue, user);
    return result.budgets;
  }

  async upsertBudget(dto: UpsertFinanceBudgetDto, user: JwtUser) {
    const category = await this.categories.findOneBy({
      id: dto.categoryId,
      householdId: user.householdId,
      kind: 'expense',
    });
    if (!category) throw new NotFoundException('支出分类不存在');
    monthRange(dto.month);
    const existing = await this.budgets.findOneBy({
      householdId: user.householdId,
      categoryId: dto.categoryId,
      month: dto.month,
    });
    if (existing && existing.version !== dto.expectedVersion) {
      throw new ConflictException('预算已更新，请刷新后重试');
    }
    if (!existing && dto.expectedVersion !== undefined) {
      throw new ConflictException('预算状态已变化，请刷新后重试');
    }
    const saved = await this.budgets.save(existing
      ? Object.assign(existing, {
          amount: money(dto.amount).toFixed(2),
          updatedById: user.memberId,
          version: existing.version + 1,
        })
      : this.budgets.create({
          householdId: user.householdId,
          categoryId: dto.categoryId,
          month: dto.month,
          amount: money(dto.amount).toFixed(2),
          version: 1,
          updatedById: user.memberId,
        }));
    return { ...saved, amount: money(saved.amount), category };
  }

  async deleteBudget(id: string, dto: DeleteFinanceBudgetDto, user: JwtUser) {
    const budget = await this.budgets.findOneBy({ id, householdId: user.householdId });
    if (!budget) throw new NotFoundException('预算不存在');
    if (budget.version !== dto.expectedVersion) {
      throw new ConflictException('预算已更新，请刷新后重试');
    }
    await this.budgets.remove(budget);
    return { deleted: true, id };
  }
}
