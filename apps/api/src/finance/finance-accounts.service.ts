import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { FinanceAccount, FinanceCategory, FinanceCategoryKind } from '../entities';
import type {
  CreateFinanceAccountDto,
  CreateFinanceCategoryDto,
  UpdateFinanceAccountDto,
  UpdateFinanceCategoryDto,
} from './finance.dto';
import { money, normalized } from './finance.helpers';

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

function creditFields(
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

function presentAccount(account: FinanceAccount, balance: number) {
  return {
    ...account,
    openingBalance: money(account.openingBalance),
    creditLimit: account.creditLimit == null ? null : money(account.creditLimit),
    balance,
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === '23505';
}

/** 账户与分类：增改查、默认分类、余额与信用卡字段（J7.2 从 FinanceService 拆出）。 */
@Injectable()
export class FinanceAccountsService {
  constructor(
    @InjectRepository(FinanceAccount)
    private readonly accounts: Repository<FinanceAccount>,
    @InjectRepository(FinanceCategory)
    private readonly categories: Repository<FinanceCategory>,
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
    return rows.map((row) => presentAccount(row, balances.get(row.id) ?? money(row.openingBalance)));
  }

  async createAccount(dto: CreateFinanceAccountDto, user: JwtUser) {
    const name = dto.name.trim();
    try {
      const saved = await this.accounts.save(
        this.accounts.create({
          householdId: user.householdId,
          name,
          type: dto.type,
          ...creditFields(dto.type, dto, null),
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
      return presentAccount(saved, money(saved.openingBalance));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('同名财务账户已经存在');
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
    Object.assign(account, creditFields(dto.type ?? account.type, dto, account));
    if (dto.type !== undefined) account.type = dto.type;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    account.version += 1;
    try {
      await this.accounts.save(account);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('同名财务账户已经存在');
      throw error;
    }
    const balances = await this.accountBalances(user.householdId);
    return presentAccount(account, balances.get(account.id) ?? money(account.openingBalance));
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
      if (isUniqueViolation(error)) throw new ConflictException('同类同名分类已经存在');
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
      if (isUniqueViolation(error)) throw new ConflictException('同类同名分类已经存在');
      throw error;
    }
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
}
