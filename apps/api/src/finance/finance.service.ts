import { householdToday, monthRange } from '@family/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { fingerprint } from '../common/fingerprint';
import {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinancePosting,
  FinanceTransaction,
  FinanceTransactionSourceType,
  FinanceRecurring,
  Household,
} from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { assertFinanceAttachment } from './finance-screenshot.service';
import { monthlyAverage } from './finance-recurring.schedule';
import type {
  CreateFinanceAccountDto,
  CreateFinanceCategoryDto,
  CreateFinanceTransactionDto,
  DeleteFinanceBudgetDto,
  FinanceTransactionQueryDto,
  ReverseFinanceTransactionDto,
  UpdateFinanceAccountDto,
  UpdateFinanceCategoryDto,
  UpsertFinanceBudgetDto,
} from './finance.module';

// 账本服务（K3 起从 finance.module.ts 原样搬出：周期账单服务要用它，放在模块文件里会互相 import）。

export const MAX_AMOUNT = 999_999_999_999.99;
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
  // K0（docs/finance-plan.md §2.6）：补到 27 个，仍平铺；排在原有分类之后、「其他支出 / 其他收入」之前
  { systemKey: 'expense_clothing', name: '服饰', kind: 'expense', icon: 'shirt', color: '#A95E78', sortOrder: 71 },
  { systemKey: 'expense_education', name: '教育', kind: 'expense', icon: 'graduation-cap', color: '#3973A6', sortOrder: 72 },
  { systemKey: 'expense_childcare', name: '育儿', kind: 'expense', icon: 'baby', color: '#B56A35', sortOrder: 73 },
  { systemKey: 'expense_pet', name: '宠物', kind: 'expense', icon: 'paw-print', color: '#7565A8', sortOrder: 74 },
  { systemKey: 'expense_telecom', name: '通讯', kind: 'expense', icon: 'smartphone', color: '#3973A6', sortOrder: 75 },
  { systemKey: 'expense_utilities', name: '水电燃气', kind: 'expense', icon: 'zap', color: '#3D6B57', sortOrder: 76 },
  { systemKey: 'expense_housing', name: '物业房租', kind: 'expense', icon: 'building-2', color: '#3D6B57', sortOrder: 77 },
  { systemKey: 'expense_insurance', name: '保险', kind: 'expense', icon: 'shield', color: '#26734D', sortOrder: 78 },
  { systemKey: 'expense_repair', name: '维修', kind: 'expense', icon: 'wrench', color: '#69736D', sortOrder: 79 },
  { systemKey: 'expense_travel', name: '旅行', kind: 'expense', icon: 'plane', color: '#3973A6', sortOrder: 80 },
  { systemKey: 'expense_digital', name: '数码', kind: 'expense', icon: 'laptop', color: '#7565A8', sortOrder: 81 },
  { systemKey: 'expense_snacks', name: '烟酒零食', kind: 'expense', icon: 'cookie', color: '#B56A35', sortOrder: 82 },
  { systemKey: 'expense_other', name: '其他支出', kind: 'expense', icon: 'circle-ellipsis', color: '#69736D', sortOrder: 90 },
  { systemKey: 'income_salary', name: '工资', kind: 'income', icon: 'landmark', color: '#26734D', sortOrder: 10 },
  { systemKey: 'income_bonus', name: '奖金', kind: 'income', icon: 'badge-dollar-sign', color: '#3973A6', sortOrder: 20 },
  { systemKey: 'income_reimbursement', name: '报销', kind: 'income', icon: 'receipt-text', color: '#B56A35', sortOrder: 30 },
  { systemKey: 'income_investment', name: '理财收益', kind: 'income', icon: 'trending-up', color: '#26734D', sortOrder: 40 },
  { systemKey: 'income_refund', name: '退款', kind: 'income', icon: 'undo-2', color: '#3973A6', sortOrder: 50 },
  { systemKey: 'income_red_packet', name: '红包', kind: 'income', icon: 'wallet', color: '#B44F55', sortOrder: 60 },
  { systemKey: 'income_other', name: '其他收入', kind: 'income', icon: 'circle-plus', color: '#69736D', sortOrder: 90 },
];

export type FinanceCreateSource = {
  sourceType: FinanceTransactionSourceType;
  sourceId?: string;
  /** K1 导入：交易单号（按家庭 + 来源唯一）与交易对方 */
  externalId?: string | null;
  merchant?: string | null;
  /** K2 截图记账：截图文件名（uploads/.private/finance/<家庭>/ 下） */
  attachmentPath?: string | null;
  /** K5 改金额 / 账户另记的新笔：记在原来那笔的记账人名下（不是改的人），记录时间沿用原笔（列表里位置不变） */
  actor?: { memberId: string; name: string };
  createdAt?: Date;
};

export function amount(value: number | string) {
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

/**
 * 流水搜索框（K5；K 收尾加金额；C2 批 2 两种都找）：纯数字（可带小数点）按金额精确找、「100-200」按金额范围找
 * （两头都算，反着写也认），同时也按文字找名称 / 商户 / 备注里含这串字的（「12306」这类），列表里金额对上的排前面；
 * 别的只按文字找。返回 null 表示没填。
 */
export function parseLedgerSearch(raw: string | undefined | null) {
  const text = raw?.trim();
  if (!text) return null;
  const number = String.raw`\d+(?:\.\d{1,2})?`;
  const exact = text.match(new RegExp(`^(${number})$`));
  if (exact) return { kind: 'amount' as const, min: Number(exact[1]).toFixed(2), max: Number(exact[1]).toFixed(2), text };
  const range = text.match(new RegExp(`^(${number})\\s*[-~～—－]\\s*(${number})$`));
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return { kind: 'amount' as const, min: low.toFixed(2), max: high.toFixed(2), text };
  }
  return { kind: 'text' as const, text };
}

export function assertDate(value: string) {
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
    private readonly clock: Clock,
    private readonly facades: PluginFacadeRegistry,
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
          ...this.creditFields(dto.type, dto, null),
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
    Object.assign(account, this.creditFields(dto.type ?? account.type, dto, account));
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

  async createTransaction(dto: CreateFinanceTransactionDto, user: JwtUser) {
    // K2：带了截图（识别接口返回的文件名）就记成 screenshot，文件得真在本家庭的截图目录里
    if (dto.attachmentPath) await assertFinanceAttachment(user.householdId, dto.attachmentPath);
    return this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager, {
        sourceType: dto.attachmentPath ? 'screenshot' : 'manual',
        merchant: dto.merchant?.trim() || null,
        attachmentPath: dto.attachmentPath ?? null,
      }),
    );
  }

  async createWithinTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
    source: FinanceCreateSource,
  ) {
    const { id, created } = await this.insertWithinTransaction(dto, user, manager, source);
    if (created) {
      await recordActivity(manager, user, {
        module: 'finance',
        action: `finance_${dto.type}_recorded`,
        summary: `${user.name}记录了${dto.type === 'expense' ? '支出' : dto.type === 'income' ? '收入' : '转账'}「${dto.title.trim()}」`,
        detail: normalized(dto.note),
        targetPath: '/finance',
        metadata: { transactionId: id, amount: money(dto.amount), sourceType: source.sourceType },
      });
    }
    return this.findTransaction(id, user.householdId, manager);
  }

  /**
   * 记一笔的核心：校验、幂等（同一个键、同样的内容返回原来那笔）、写流水与复式过账。不记动态、不重读整笔——
   * 账单导入一次几百上千笔，动态记一条汇总（K1）；普通记账走上面的 createWithinTransaction。
   */
  async insertWithinTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
    source: FinanceCreateSource,
  ): Promise<{ id: string; created: boolean }> {
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
      return { id: existing.id, created: false };
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
        actorId: source.actor?.memberId ?? user.memberId,
        actorName: source.actor?.name ?? user.name,
        sourceType: source.sourceType,
        sourceId: source.sourceId ?? randomUUID(),
        externalId: source.externalId ?? null,
        merchant: source.merchant ?? null,
        attachmentPath: source.attachmentPath ?? null,
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        reversalOfId: null,
        ...(source.createdAt ? { createdAt: source.createdAt } : {}),
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
    return { id: transaction.id, created: true };
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
      const reversal = await this.insertReversal(manager, original, user, {
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        note: normalized(dto.note),
        occurredOn: await this.today(user.householdId),
      });
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

  /**
   * 冲销一笔：另记一笔 reversal，分录金额全部取反。调用方负责校验能不能冲销、锁住原笔。
   * K5 的改金额 / 删除也走这里（冲销笔记在原笔那天，列表里和原笔一起折叠）。
   */
  async insertReversal(
    manager: EntityManager,
    original: FinanceTransaction,
    user: JwtUser,
    options: { idempotencyKey: string; requestFingerprint?: string; note?: string | null; occurredOn: string },
  ) {
    const repository = manager.getRepository(FinanceTransaction);
    const reversal = await repository.save(repository.create({
      householdId: user.householdId,
      type: 'reversal',
      amount: original.amount,
      currency: 'CNY',
      title: `撤销：${original.title}`.slice(0, 120),
      note: options.note ?? null,
      occurredOn: options.occurredOn,
      categoryId: original.categoryId,
      actorId: user.memberId,
      actorName: user.name,
      sourceType: 'finance_transaction',
      sourceId: original.id,
      idempotencyKey: options.idempotencyKey,
      requestFingerprint: options.requestFingerprint ?? fingerprint({ reversalOfId: original.id, note: options.note ?? null }),
      reversalOfId: original.id,
    }));
    const postings = manager.getRepository(FinancePosting);
    await postings.save(original.postings.map((posting) => postings.create({
      householdId: user.householdId,
      transactionId: reversal.id,
      accountId: posting.accountId,
      delta: (-money(posting.delta)).toFixed(2),
    })));
    return reversal;
  }

  private async today(householdId: string): Promise<string> {
    const timezone = (await this.dataSource.getRepository(Household).findOneByOrFail({ id: householdId })).timezone;
    return householdToday(timezone, this.clock.now());
  }

  async listTransactions(query: FinanceTransactionQueryDto, user: JwtUser) {
    const month = (query.month ?? (await this.today(user.householdId)).slice(0, 7));
    const { start, end } = monthRange(month);
    if (query.accountId) await this.requireAccount(query.accountId, user.householdId, this.dataSource.manager, true);
    const limit = query.limit ?? 100;
    /** 月份、类型、账户、分类、成员、已删除这些筛选每次查询都一样；搜索另外加 */
    const filtered = () => {
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
        .take(limit);
      if (query.type) builder.andWhere('transaction.type = :type', { type: query.type });
      if (query.accountId) builder.andWhere('posting.accountId = :accountId', { accountId: query.accountId });
      // K5：改金额 / 删除时记的冲销笔不进列表（它们是账本内部的一对）；被替代、删除的原笔要「显示已删除」才列
      builder.andWhere(
        `NOT (transaction.type = 'reversal' AND EXISTS (
           SELECT 1 FROM finance_transactions hidden
            WHERE hidden.id = transaction."reversalOfId"
              AND (hidden."deletedAt" IS NOT NULL OR hidden."supersededById" IS NOT NULL)))`,
      );
      if (query.includeDeleted !== 'true') {
        builder.andWhere('transaction.deletedAt IS NULL AND transaction.supersededById IS NULL');
      }
      if (query.categoryId) builder.andWhere('transaction.categoryId = :categoryId', { categoryId: query.categoryId });
      if (query.memberId) builder.andWhere('transaction.actorId = :memberId', { memberId: query.memberId });
      return builder;
    };
    const search = parseLedgerSearch(query.q);
    if (!search) return this.presentTransactions(await filtered().getMany(), user.householdId);
    const textMatch = '(transaction.title ILIKE :q OR transaction.merchant ILIKE :q OR transaction.note ILIKE :q)';
    const q = `%${search.text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    if (search.kind === 'text') {
      return this.presentTransactions(await filtered().andWhere(textMatch, { q }).getMany(), user.householdId);
    }
    // 纯数字：金额对上的在前；名称 / 商户 / 备注含这串数字、金额又不对的补在后面，总数仍不超过 limit。
    // 分两次查，不在一条里按表达式排序：take + 关联表时 TypeORM 会把分页算错（K5 踩过）
    const amount = { minAmount: search.min, maxAmount: search.max };
    const byAmount = await filtered().andWhere('transaction.amount BETWEEN :minAmount AND :maxAmount', amount).getMany();
    const byText = byAmount.length >= limit
      ? []
      : await filtered()
          .andWhere(textMatch, { q })
          .andWhere('transaction.amount NOT BETWEEN :minAmount AND :maxAmount', amount)
          .take(limit - byAmount.length)
          .getMany();
    return this.presentTransactions([...byAmount, ...byText], user.householdId);
  }

  async summary(monthValue: string | undefined, user: JwtUser) {
    const month = (monthValue ?? (await this.today(user.householdId)).slice(0, 7));
    const { start, end } = monthRange(month);
    const [accounts, categories, budgets, spendingRows, totalsRows, fixedCosts] = await Promise.all([
      this.listAccounts(user, true),
      this.listCategories(user, true),
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

  /**
   * 按 systemKey 缺则补（ON CONFLICT DO NOTHING）：老家庭升级后第一次读分类时补上新加的默认分类；
   * 用户改过名的内置分类 systemKey 还在，不会再插一条；与用户自建的同类同名分类冲突时也跳过，不覆盖。
   */
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

  /**
   * K4：信用卡必须有账单日、还款日（每月几号），额度选填；别的类型三项都得为空（库里也有 CHECK）。
   * 改账户时没传的沿用原值；从信用卡改成别的类型时一并清掉。
   */
  private creditFields(
    type: FinanceAccount['type'],
    input: { creditLimit?: number | null; billingDay?: number | null; dueDay?: number | null },
    current: FinanceAccount | null,
  ) {
    const keep = <T>(value: T | undefined, fallback: T | null) => (value === undefined ? fallback : value);
    if (type !== 'credit') {
      if (input.creditLimit != null || input.billingDay != null || input.dueDay != null) {
        throw new BadRequestException('只有信用卡能填额度、账单日和还款日');
      }
      return { creditLimit: null, billingDay: null, dueDay: null };
    }
    const wasCredit = current?.type === 'credit';
    const billingDay = keep(input.billingDay, wasCredit ? current.billingDay : null);
    const dueDay = keep(input.dueDay, wasCredit ? current.dueDay : null);
    if (!billingDay || !dueDay) throw new BadRequestException('信用卡要填每月几号出账单、几号还款');
    const creditLimit: number | string | null =
      input.creditLimit !== undefined ? input.creditLimit : wasCredit ? current.creditLimit : null;
    return { creditLimit: creditLimit == null ? null : money(creditLimit).toFixed(2), billingDay, dueDay };
  }

  private presentAccount(account: FinanceAccount, balance: number) {
    return {
      ...account,
      openingBalance: money(account.openingBalance),
      creditLimit: account.creditLimit == null ? null : money(account.creditLimit),
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
    const replacedIds = rows.map((row) => row.supersededById).filter((id): id is string => Boolean(id));
    const replacements = replacedIds.length
      ? await this.transactions.find({ where: { householdId, id: In(replacedIds) }, select: { id: true, amount: true, type: true } })
      : [];
    const replacedBy = new Map(replacements.map((row) => [row.id, { id: row.id, amount: money(row.amount), type: row.type }]));
    return rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      supersededBy: row.supersededById ? replacedBy.get(row.supersededById) ?? null : null,
      // 分录顺序原来随查询计划变：固定成先写的在前，同一刻写的负数（转出）在前
      postings: [...row.postings]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.delta) - Number(b.delta))
        .map((posting) => ({ ...posting, delta: money(posting.delta) })),
      reversed: reversed.has(row.id),
      reversalId: reversed.get(row.id) ?? null,
    }));
  }

  /** 按 id 取一笔流水（与写接口回传同一形状）；周期账单「已付」回传落下的那一笔用。 */
  getTransaction(id: string, householdId: string) {
    return this.findTransaction(id, householdId, this.dataSource.manager);
  }

  async findTransaction(id: string, householdId: string, manager: EntityManager) {
    const row = await manager.getRepository(FinanceTransaction).findOne({
      where: { id, householdId },
      relations: { category: true, actor: true, postings: { account: true } },
    });
    if (!row) throw new NotFoundException('财务流水不存在');
    return (await this.presentTransactions([row], householdId))[0];
  }

  lockIdempotency(manager: EntityManager, householdId: string, key: string) {
    return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${householdId}:finance:${key}`,
    ]);
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error &&
      (error as { code?: string }).code === '23505';
  }
}
