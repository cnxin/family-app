import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
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
import { randomUUID } from 'node:crypto';
import { fingerprint } from '../common/fingerprint';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import {
  assertCapability,
  RequireCapabilities,
} from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinancePosting,
  FinanceTransaction,
  FinanceTransactionSourceType,
  FinanceTransactionType,
} from '../entities';

const ACCOUNT_TYPES: FinanceAccountType[] = [
  'cash',
  'bank',
  'alipay',
  'wechat',
  'other',
];
const TRANSACTION_TYPES: Exclude<FinanceTransactionType, 'reversal'>[] = [
  'expense',
  'income',
  'transfer',
];
const MAX_AMOUNT = 999_999_999_999.99;
const DEFAULT_CATEGORIES: {
  systemKey: string;
  name: string;
  kind: FinanceCategoryKind;
  icon: string;
  color: string;
  sortOrder: number;
}[] = [
  { systemKey: 'expense_food', name: '餐饮', kind: 'expense', icon: 'utensils', color: '#26734D', sortOrder: 10 },
  { systemKey: 'expense_home', name: '居家', kind: 'expense', icon: 'house', color: '#3D6B57', sortOrder: 20 },
  { systemKey: 'expense_transport', name: '交通', kind: 'expense', icon: 'car', color: '#3973A6', sortOrder: 30 },
  { systemKey: 'expense_shopping', name: '购物', kind: 'expense', icon: 'shopping-bag', color: '#B56A35', sortOrder: 40 },
  { systemKey: 'expense_entertainment', name: '娱乐', kind: 'expense', icon: 'film', color: '#7565A8', sortOrder: 50 },
  { systemKey: 'expense_health', name: '医疗', kind: 'expense', icon: 'heart-pulse', color: '#B44F55', sortOrder: 60 },
  { systemKey: 'expense_gift', name: '人情', kind: 'expense', icon: 'gift', color: '#A95E78', sortOrder: 70 },
  { systemKey: 'expense_other', name: '其他支出', kind: 'expense', icon: 'circle-ellipsis', color: '#69736D', sortOrder: 90 },
  { systemKey: 'income_salary', name: '工资', kind: 'income', icon: 'landmark', color: '#26734D', sortOrder: 10 },
  { systemKey: 'income_bonus', name: '奖金', kind: 'income', icon: 'badge-dollar-sign', color: '#3973A6', sortOrder: 20 },
  { systemKey: 'income_reimbursement', name: '报销', kind: 'income', icon: 'receipt-text', color: '#B56A35', sortOrder: 30 },
  { systemKey: 'income_other', name: '其他收入', kind: 'income', icon: 'circle-plus', color: '#69736D', sortOrder: 90 },
];

class FinanceMonthQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

class FinanceTransactionQueryDto extends FinanceMonthQueryDto {
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
}

class CreateFinanceAccountDto {
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
}

class UpdateFinanceAccountDto {
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

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

class CreateFinanceCategoryDto {
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

class UpdateFinanceCategoryDto {
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

class ReverseFinanceTransactionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class UpsertFinanceBudgetDto {
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

class DeleteFinanceBudgetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

type FinanceCreateSource = {
  sourceType: FinanceTransactionSourceType;
  sourceId?: string;
};

function amount(value: number | string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_AMOUNT) {
    throw new BadRequestException(`金额必须在 0.01 到 ${MAX_AMOUNT} 之间`);
  }
  return parsed.toFixed(2);
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Math.round(parsed * 100) / 100;
}

function normalized(value?: string | null) {
  return value?.trim() || null;
}

function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException('月份必须使用 YYYY-MM 格式');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return { start: `${month}-01`, end: next };
}

function assertDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('记账日期不是有效的日历日期');
  }
}

@Injectable()
export class FinanceService {
  constructor(
    @InjectRepository(FinanceAccount)
    private readonly accounts: Repository<FinanceAccount>,
    @InjectRepository(FinanceCategory)
    private readonly categories: Repository<FinanceCategory>,
    @InjectRepository(FinanceTransaction)
    private readonly transactions: Repository<FinanceTransaction>,
    @InjectRepository(FinanceBudget)
    private readonly budgets: Repository<FinanceBudget>,
    private readonly dataSource: DataSource,
  ) {}

  async listAccounts(user: JwtUser, includeInactive = false) {
    const rows = await this.accounts.find({
      where: {
        householdId: user.householdId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { isActive: 'DESC', createdAt: 'ASC' },
    });
    const balances = await this.accountBalances(user.householdId);
    return rows.map((row) => this.presentAccount(row, balances.get(row.id) ?? money(row.openingBalance)));
  }

  async createAccount(dto: CreateFinanceAccountDto, user: JwtUser) {
    const name = dto.name.trim();
    try {
      const saved = await this.accounts.save(
        this.accounts.create({
          householdId: user.householdId,
          name,
          type: dto.type,
          openingBalance: money(dto.openingBalance).toFixed(2),
          currency: 'CNY',
          isActive: true,
          version: 1,
          createdById: user.memberId,
        }),
      );
      await this.dataSource.transaction((manager) =>
        recordActivity(manager, user, {
          module: 'finance',
          action: 'finance_account_created',
          summary: `${user.name}新增了财务账户「${name}」`,
          targetPath: '/finance',
          metadata: { accountId: saved.id, type: saved.type },
        }),
      );
      return this.presentAccount(saved, money(saved.openingBalance));
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('同名财务账户已经存在');
      throw error;
    }
  }

  async updateAccount(id: string, dto: UpdateFinanceAccountDto, user: JwtUser) {
    const account = await this.accounts.findOneBy({ id, householdId: user.householdId });
    if (!account) throw new NotFoundException('财务账户不存在');
    if (account.version !== dto.expectedVersion) {
      throw new ConflictException('账户已更新，请刷新后重试');
    }
    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.type !== undefined) account.type = dto.type;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    account.version += 1;
    try {
      await this.accounts.save(account);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('同名财务账户已经存在');
      throw error;
    }
    const balances = await this.accountBalances(user.householdId);
    return this.presentAccount(account, balances.get(account.id) ?? money(account.openingBalance));
  }

  async listCategories(user: JwtUser, includeInactive = false) {
    await this.ensureDefaultCategories(user);
    return this.categories.find({
      where: {
        householdId: user.householdId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { kind: 'ASC', sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createCategory(dto: CreateFinanceCategoryDto, user: JwtUser) {
    try {
      return await this.categories.save(
        this.categories.create({
          householdId: user.householdId,
          name: dto.name.trim(),
          kind: dto.kind,
          systemKey: null,
          icon: normalized(dto.icon) ?? 'circle',
          color: dto.color ?? '#26734D',
          sortOrder: 100,
          isActive: true,
          version: 1,
          createdById: user.memberId,
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('同类同名分类已经存在');
      throw error;
    }
  }

  async updateCategory(id: string, dto: UpdateFinanceCategoryDto, user: JwtUser) {
    const category = await this.categories.findOneBy({ id, householdId: user.householdId });
    if (!category) throw new NotFoundException('财务分类不存在');
    if (category.version !== dto.expectedVersion) {
      throw new ConflictException('分类已更新，请刷新后重试');
    }
    if (dto.name !== undefined) category.name = dto.name.trim();
    if (dto.icon !== undefined) category.icon = dto.icon.trim();
    if (dto.color !== undefined) category.color = dto.color;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;
    category.version += 1;
    try {
      return await this.categories.save(category);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('同类同名分类已经存在');
      throw error;
    }
  }

  async previewTransaction(dto: CreateFinanceTransactionDto, user: JwtUser) {
    const prepared = await this.prepareTransaction(dto, user, this.dataSource.manager);
    return {
      type: dto.type,
      amount: money(dto.amount),
      title: dto.title.trim(),
      occurredOn: dto.occurredOn,
      account: { id: prepared.account.id, name: prepared.account.name },
      toAccount: prepared.toAccount
        ? { id: prepared.toAccount.id, name: prepared.toAccount.name }
        : null,
      category: prepared.category
        ? { id: prepared.category.id, name: prepared.category.name }
        : null,
    };
  }

  createTransaction(dto: CreateFinanceTransactionDto, user: JwtUser) {
    return this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager, { sourceType: 'manual' }),
    );
  }

  async createWithinTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
    source: FinanceCreateSource,
  ) {
    assertCapability(user, 'record_finance');
    const prepared = await this.prepareTransaction(dto, user, manager);
    const requestFingerprint = fingerprint({
      type: dto.type,
      amount: amount(dto.amount),
      accountId: dto.accountId,
      toAccountId: dto.toAccountId ?? null,
      categoryId: dto.categoryId ?? null,
      title: dto.title.trim(),
      note: normalized(dto.note),
      occurredOn: dto.occurredOn,
      sourceType: source.sourceType,
      sourceId: source.sourceId ?? null,
    });
    await this.lockIdempotency(manager, user.householdId, dto.idempotencyKey);
    const repository = manager.getRepository(FinanceTransaction);
    const existing = await repository.findOneBy({
      householdId: user.householdId,
      idempotencyKey: dto.idempotencyKey,
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ConflictException('幂等键已用于另一笔不同的财务流水');
      }
      return this.findTransaction(existing.id, user.householdId, manager);
    }

    const transaction = await repository.save(
      repository.create({
        householdId: user.householdId,
        type: dto.type,
        amount: amount(dto.amount),
        currency: 'CNY',
        title: dto.title.trim(),
        note: normalized(dto.note),
        occurredOn: dto.occurredOn,
        categoryId: prepared.category?.id ?? null,
        actorId: user.memberId,
        actorName: user.name,
        sourceType: source.sourceType,
        sourceId: source.sourceId ?? randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        reversalOfId: null,
      }),
    );
    const postings = manager.getRepository(FinancePosting);
    if (dto.type === 'expense') {
      await postings.save(postings.create({
        householdId: user.householdId,
        transactionId: transaction.id,
        accountId: prepared.account.id,
        delta: (-money(dto.amount)).toFixed(2),
      }));
    } else if (dto.type === 'income') {
      await postings.save(postings.create({
        householdId: user.householdId,
        transactionId: transaction.id,
        accountId: prepared.account.id,
        delta: amount(dto.amount),
      }));
    } else {
      await postings.save([
        postings.create({
          householdId: user.householdId,
          transactionId: transaction.id,
          accountId: prepared.account.id,
          delta: (-money(dto.amount)).toFixed(2),
        }),
        postings.create({
          householdId: user.householdId,
          transactionId: transaction.id,
          accountId: prepared.toAccount!.id,
          delta: amount(dto.amount),
        }),
      ]);
    }
    await recordActivity(manager, user, {
      module: 'finance',
      action: `finance_${dto.type}_recorded`,
      summary: `${user.name}记录了${dto.type === 'expense' ? '支出' : dto.type === 'income' ? '收入' : '转账'}「${dto.title.trim()}」`,
      detail: normalized(dto.note),
      targetPath: '/finance',
      metadata: { transactionId: transaction.id, amount: money(dto.amount), sourceType: source.sourceType },
    });
    return this.findTransaction(transaction.id, user.householdId, manager);
  }

  async reverseTransaction(
    id: string,
    dto: ReverseFinanceTransactionDto,
    user: JwtUser,
  ) {
    assertCapability(user, 'manage_finance');
    return this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(manager, user.householdId, dto.idempotencyKey);
      const repository = manager.getRepository(FinanceTransaction);
      const original = await repository.findOne({
        where: { id, householdId: user.householdId },
        relations: { postings: true },
      });
      if (!original) throw new NotFoundException('财务流水不存在');
      if (original.type === 'reversal') throw new BadRequestException('撤销流水不能再次撤销');
      const existingReversal = await repository.findOneBy({
        householdId: user.householdId,
        reversalOfId: original.id,
      });
      if (existingReversal) {
        if (existingReversal.idempotencyKey !== dto.idempotencyKey) {
          throw new ConflictException('这笔财务流水已经撤销');
        }
        return this.findTransaction(existingReversal.id, user.householdId, manager);
      }
      const requestFingerprint = fingerprint({
        reversalOfId: original.id,
        note: normalized(dto.note),
      });
      const duplicate = await repository.findOneBy({
        householdId: user.householdId,
        idempotencyKey: dto.idempotencyKey,
      });
      if (duplicate) {
        if (duplicate.requestFingerprint !== requestFingerprint) {
          throw new ConflictException('幂等键已用于另一笔不同的财务流水');
        }
        return this.findTransaction(duplicate.id, user.householdId, manager);
      }
      const reversal = await repository.save(repository.create({
        householdId: user.householdId,
        type: 'reversal',
        amount: original.amount,
        currency: 'CNY',
        title: `撤销：${original.title}`.slice(0, 120),
        note: normalized(dto.note),
        occurredOn: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
        categoryId: original.categoryId,
        actorId: user.memberId,
        actorName: user.name,
        sourceType: 'finance_transaction',
        sourceId: original.id,
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        reversalOfId: original.id,
      }));
      const postings = manager.getRepository(FinancePosting);
      await postings.save(original.postings.map((posting) => postings.create({
        householdId: user.householdId,
        transactionId: reversal.id,
        accountId: posting.accountId,
        delta: (-money(posting.delta)).toFixed(2),
      })));
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_transaction_reversed',
        summary: `${user.name}撤销了财务流水「${original.title}」`,
        detail: normalized(dto.note),
        targetPath: '/finance',
        metadata: { transactionId: reversal.id, reversalOfId: original.id },
      });
      return this.findTransaction(reversal.id, user.householdId, manager);
    });
  }

  async listTransactions(query: FinanceTransactionQueryDto, user: JwtUser) {
    const month = query.month ?? currentMonth();
    const { start, end } = monthRange(month);
    if (query.accountId) await this.requireAccount(query.accountId, user.householdId, this.dataSource.manager, true);
    const builder = this.transactions
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.category', 'category')
      .leftJoinAndSelect('transaction.actor', 'actor')
      .leftJoinAndSelect('transaction.postings', 'posting')
      .leftJoinAndSelect('posting.account', 'account')
      .where('transaction.householdId = :householdId', { householdId: user.householdId })
      .andWhere('transaction.occurredOn >= :start AND transaction.occurredOn < :end', { start, end })
      .orderBy('transaction.occurredOn', 'DESC')
      .addOrderBy('transaction.createdAt', 'DESC')
      .take(query.limit ?? 100);
    if (query.type) builder.andWhere('transaction.type = :type', { type: query.type });
    if (query.accountId) builder.andWhere('posting.accountId = :accountId', { accountId: query.accountId });
    const rows = await builder.getMany();
    return this.presentTransactions(rows, user.householdId);
  }

  async summary(monthValue: string | undefined, user: JwtUser) {
    const month = monthValue ?? currentMonth();
    const { start, end } = monthRange(month);
    const [accounts, categories, budgets, spendingRows, totalsRows] = await Promise.all([
      this.listAccounts(user, true),
      this.listCategories(user, true),
      this.budgets.find({ where: { householdId: user.householdId, month }, order: { createdAt: 'ASC' } }),
      this.transactions.query(
        `SELECT t."categoryId", COALESCE(SUM(t."amount"), 0) AS spent
         FROM "finance_transactions" t
         LEFT JOIN "finance_transactions" r ON r."reversalOfId" = t.id
         WHERE t."householdId" = $1 AND t.type = 'expense'
           AND t."occurredOn" >= $2 AND t."occurredOn" < $3 AND r.id IS NULL
         GROUP BY t."categoryId"`,
        [user.householdId, start, end],
      ) as Promise<{ categoryId: string; spent: string }[]>,
      this.transactions.query(
        `SELECT t.type, COALESCE(SUM(t."amount"), 0) AS amount
         FROM "finance_transactions" t
         LEFT JOIN "finance_transactions" r ON r."reversalOfId" = t.id
         WHERE t."householdId" = $1 AND t.type IN ('expense', 'income')
           AND t."occurredOn" >= $2 AND t."occurredOn" < $3 AND r.id IS NULL
         GROUP BY t.type`,
        [user.householdId, start, end],
      ) as Promise<{ type: 'expense' | 'income'; amount: string }[]>,
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
    };
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

  private async prepareTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
  ) {
    assertDate(dto.occurredOn);
    amount(dto.amount);
    const account = await this.requireAccount(dto.accountId, user.householdId, manager, false);
    let toAccount: FinanceAccount | null = null;
    let category: FinanceCategory | null = null;
    if (dto.type === 'transfer') {
      if (!dto.toAccountId) throw new BadRequestException('转账必须选择转入账户');
      if (dto.toAccountId === dto.accountId) throw new BadRequestException('转出与转入账户不能相同');
      if (dto.categoryId) throw new BadRequestException('账户间转账不使用收支分类');
      toAccount = await this.requireAccount(dto.toAccountId, user.householdId, manager, false);
    } else {
      if (dto.toAccountId) throw new BadRequestException('收支流水不能设置转入账户');
      if (!dto.categoryId) throw new BadRequestException('收入和支出必须选择分类');
      category = await manager.getRepository(FinanceCategory).findOneBy({
        id: dto.categoryId,
        householdId: user.householdId,
        kind: dto.type,
        isActive: true,
      });
      if (!category) throw new NotFoundException('所选收支分类不存在或已停用');
    }
    return { account, toAccount, category };
  }

  private async requireAccount(
    id: string,
    householdId: string,
    manager: EntityManager,
    includeInactive: boolean,
  ) {
    const account = await manager.getRepository(FinanceAccount).findOneBy({
      id,
      householdId,
      ...(includeInactive ? {} : { isActive: true }),
    });
    if (!account) throw new NotFoundException('财务账户不存在或已停用');
    return account;
  }

  private async ensureDefaultCategories(user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      for (const category of DEFAULT_CATEGORIES) {
        await manager.createQueryBuilder()
          .insert()
          .into(FinanceCategory)
          .values({
            householdId: user.householdId,
            ...category,
            isActive: true,
            version: 1,
            createdById: user.memberId,
          })
          .orIgnore()
          .execute();
      }
    });
  }

  private async accountBalances(householdId: string) {
    const rows = await this.accounts.query(
      `SELECT a.id, a."openingBalance" + COALESCE(SUM(p.delta), 0) AS balance
       FROM "finance_accounts" a
       LEFT JOIN "finance_postings" p ON p."accountId" = a.id
       WHERE a."householdId" = $1
       GROUP BY a.id, a."openingBalance"`,
      [householdId],
    ) as { id: string; balance: string }[];
    return new Map(rows.map((row) => [row.id, money(row.balance)]));
  }

  private presentAccount(account: FinanceAccount, balance: number) {
    return {
      ...account,
      openingBalance: money(account.openingBalance),
      balance,
    };
  }

  private async presentTransactions(rows: FinanceTransaction[], householdId: string) {
    if (!rows.length) return [];
    const reversals = await this.transactions.find({
      where: { householdId, reversalOfId: In(rows.map((row) => row.id)) },
      select: { id: true, reversalOfId: true },
    });
    const reversed = new Map(reversals.map((row) => [row.reversalOfId, row.id]));
    return rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      postings: row.postings.map((posting) => ({ ...posting, delta: money(posting.delta) })),
      reversed: reversed.has(row.id),
      reversalId: reversed.get(row.id) ?? null,
    }));
  }

  private async findTransaction(id: string, householdId: string, manager: EntityManager) {
    const row = await manager.getRepository(FinanceTransaction).findOne({
      where: { id, householdId },
      relations: { category: true, actor: true, postings: { account: true } },
    });
    if (!row) throw new NotFoundException('财务流水不存在');
    return (await this.presentTransactions([row], householdId))[0];
  }

  private lockIdempotency(manager: EntityManager, householdId: string, key: string) {
    return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${householdId}:finance:${key}`,
    ]);
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error &&
      (error as { code?: string }).code === '23505';
  }
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
    TypeOrmModule.forFeature([
      FinanceAccount,
      FinanceBudget,
      FinanceCategory,
      FinancePosting,
      FinanceTransaction,
    ]),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
