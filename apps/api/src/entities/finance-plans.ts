import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceCategoryKind, FinanceAccount, FinanceCategory } from './finance';
import { Household, Member } from './household';

export type FinanceRecurringCadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type FinanceImportSource = 'alipay' | 'wechat' | 'csv';

export type FinanceImportStatus = 'previewing' | 'committed' | 'discarded';

@Entity('finance_budgets')
@Check('CHK_finance_budgets_amount', `"amount" >= 0`)
@Check('CHK_finance_budgets_month', `"month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
@Check('CHK_finance_budgets_version', `"version" >= 1`)
@Unique('UQ_finance_budgets_household_category_month', [
  'householdId',
  'categoryId',
  'month',
])
@Index('IDX_finance_budgets_household_month', ['householdId', 'month'])
export class FinanceBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_budgets_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FinanceCategory, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'categoryId',
    foreignKeyConstraintName: 'FK_finance_budgets_category',
  })
  category: FinanceCategory;

  @Column('uuid')
  categoryId: string;

  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_finance_budgets_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** K3 周期账单（docs/finance-plan.md §2.4）。 */
@Entity('finance_recurring')
@Check('CHK_finance_recurring_type', `"type" IN ('expense', 'income')`)
@Check('CHK_finance_recurring_amount', `"amount" > 0`)
@Check(
  'CHK_finance_recurring_cadence',
  `"cadence" IN ('weekly', 'monthly', 'quarterly', 'yearly')`,
)
@Check('CHK_finance_recurring_next_due', `"nextDueOn" >= "anchorOn"`)
@Check('CHK_finance_recurring_version', `"version" >= 1`)
@Index('IDX_finance_recurring_household_due', ['householdId', 'isActive', 'nextDueOn'])
export class FinanceRecurring {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_recurring_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceCategoryKind;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @ManyToOne(() => FinanceAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_finance_recurring_account',
  })
  account: FinanceAccount;

  @Column('uuid')
  accountId: string;

  @ManyToOne(() => FinanceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'categoryId',
    foreignKeyConstraintName: 'FK_finance_recurring_category',
  })
  category: FinanceCategory;

  @Column('uuid')
  categoryId: string;

  @Column({ type: 'varchar', length: 16 })
  cadence: FinanceRecurringCadence;

  /** 第一次应付日；monthly / quarterly / yearly 取它的「日」，29～31 日在短月按月末算。 */
  @Column({ type: 'date' })
  anchorOn: string;

  @Column({ type: 'date' })
  nextDueOn: string;

  @Column({ default: false })
  autoPost: boolean;

  @Column({ type: 'date', nullable: true })
  lastPostedOn: string | null;

  /** K 收尾：自动记账落失败的原因（给人看的一句话）与时间；有值时调度不再重试，管理员重试或改规则后清空 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_finance_recurring_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_finance_recurring_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** K1 账单导入批次（docs/finance-plan.md §2.2）。preview 是解析结果，确认 / 放弃后清空。 */
@Entity('finance_imports')
@Check('CHK_finance_imports_source', `"source" IN ('alipay', 'wechat', 'csv')`)
@Check('CHK_finance_imports_status', `"status" IN ('previewing', 'committed', 'discarded')`)
@Check(
  'CHK_finance_imports_counts',
  `"totalRows" >= 0 AND "importedRows" >= 0 AND "skippedRows" >= 0 AND "duplicateRows" >= 0`,
)
@Index('IDX_finance_imports_household_created', ['householdId', 'createdAt'])
export class FinanceImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_finance_imports_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 16 })
  source: FinanceImportSource;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @ManyToOne(() => FinanceAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accountId', foreignKeyConstraintName: 'FK_finance_imports_account' })
  account: FinanceAccount;

  @Column('uuid')
  accountId: string;

  @Column({ type: 'varchar', length: 16, default: 'previewing' })
  status: FinanceImportStatus;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  importedRows: number;

  @Column({ type: 'int', default: 0 })
  skippedRows: number;

  @Column({ type: 'int', default: 0 })
  duplicateRows: number;

  @Column({ type: 'date', nullable: true })
  rangeFrom: string | null;

  @Column({ type: 'date', nullable: true })
  rangeTo: string | null;

  /** 通用 CSV 的列对应（字段 → 第几列） */
  @Column({ type: 'jsonb', nullable: true })
  columnMapping: Record<string, number | null> | null;

  /** 解析结果（预览阶段）；确认或放弃后清空 */
  @Column({ type: 'jsonb', nullable: true })
  preview: unknown;

  /** 确认时这一批的所有单号（导了的和选了不导的）：同一份账单再导一次整份标「以前导过」 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  processedExternalIds: string[];

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'createdById', foreignKeyConstraintName: 'FK_finance_imports_created_by' })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  committedAt: Date | null;
}

/** K1 家里学到的「商户 → 分类」（docs/finance-plan.md §2.3）。pattern 是归一化后的商户名。 */
@Entity('finance_merchant_rules')
@Unique('UQ_finance_merchant_rules_household_pattern_kind', ['householdId', 'pattern', 'kind'])
@Check('CHK_finance_merchant_rules_kind', `"kind" IN ('expense', 'income')`)
@Check('CHK_finance_merchant_rules_hits', `"hits" >= 0`)
export class FinanceMerchantRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_finance_merchant_rules_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  pattern: string;

  @Column({ type: 'varchar', length: 16 })
  kind: FinanceCategoryKind;

  @ManyToOne(() => FinanceCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'categoryId', foreignKeyConstraintName: 'FK_finance_merchant_rules_category' })
  category: FinanceCategory;

  @Column('uuid')
  categoryId: string;

  @Column({ type: 'int', default: 0 })
  hits: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
