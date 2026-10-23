import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';

export type FinanceAccountType =
  | 'cash'
  | 'bank'
  | 'alipay'
  | 'wechat'
  | 'other'
  | 'credit';

export type FinanceCategoryKind = 'expense' | 'income';

export type FinanceTransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'reversal';

export type FinanceTransactionSourceType =
  | 'manual'
  | 'agent'
  | 'shopping_item'
  | 'asset'
  | 'media_subscription'
  | 'finance_transaction'
  | 'import'
  | 'recurring'
  | 'screenshot';

@Entity('finance_accounts')
@Check(
  'CHK_finance_accounts_type',
  `"type" IN ('cash', 'bank', 'alipay', 'wechat', 'other', 'credit')`,
)
@Check(
  'CHK_finance_accounts_credit_fields',
  `"type" = 'credit' OR ("creditLimit" IS NULL AND "billingDay" IS NULL AND "dueDay" IS NULL)`,
)
@Check('CHK_finance_accounts_credit_limit', `"creditLimit" IS NULL OR "creditLimit" > 0`)
@Check(
  'CHK_finance_accounts_billing_day',
  `"billingDay" IS NULL OR ("billingDay" >= 1 AND "billingDay" <= 31)`,
)
@Check(
  'CHK_finance_accounts_due_day',
  `"dueDay" IS NULL OR ("dueDay" >= 1 AND "dueDay" <= 31)`,
)
@Check('CHK_finance_accounts_currency', `"currency" = 'CNY'`)
@Check('CHK_finance_accounts_version', `"version" >= 1`)
@Unique('UQ_finance_accounts_household_name', ['householdId', 'name'])
@Index('IDX_finance_accounts_household_active', [
  'householdId',
  'isActive',
  'createdAt',
])
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_accounts_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceAccountType;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  openingBalance: string;

  /** K4 信用卡额度（只有 credit 有）。 */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  creditLimit: string | null;

  /** K4 信用卡每月几号出账单（只有 credit 有）。 */
  @Column({ type: 'smallint', nullable: true })
  billingDay: number | null;

  /** K4 信用卡每月几号还款（只有 credit 有）。 */
  @Column({ type: 'smallint', nullable: true })
  dueDay: number | null;

  @Column({ type: 'varchar', length: 3, default: 'CNY' })
  currency: 'CNY';

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_finance_accounts_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('finance_categories')
@Check(
  'CHK_finance_categories_kind',
  `"kind" IN ('expense', 'income')`,
)
@Check('CHK_finance_categories_version', `"version" >= 1`)
@Unique('UQ_finance_categories_household_kind_name', [
  'householdId',
  'kind',
  'name',
])
@Index('UQ_finance_categories_household_system_key', [
  'householdId',
  'systemKey',
], {
  unique: true,
  where: '"systemKey" IS NOT NULL',
})
@Index('IDX_finance_categories_household_kind_active', [
  'householdId',
  'kind',
  'isActive',
  'sortOrder',
])
export class FinanceCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_categories_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  kind: FinanceCategoryKind;

  @Column({ type: 'varchar', length: 64, nullable: true })
  systemKey: string | null;

  @Column({ type: 'varchar', length: 32, default: 'circle' })
  icon: string;

  @Column({ type: 'varchar', length: 7, default: '#26734D' })
  color: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_finance_categories_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('finance_transactions')
@Check(
  'CHK_finance_transactions_type',
  `"type" IN ('expense', 'income', 'transfer', 'reversal')`,
)
@Check(
  'CHK_finance_transactions_source_type',
  `"sourceType" IN ('manual', 'agent', 'shopping_item', 'asset', 'media_subscription', 'finance_transaction', 'import', 'recurring', 'screenshot')`,
)
@Check('CHK_finance_transactions_amount', `"amount" > 0`)
@Check('CHK_finance_transactions_currency', `"currency" = 'CNY'`)
@Check(
  'CHK_finance_transactions_category',
  `("type" IN ('expense', 'income') AND "categoryId" IS NOT NULL) OR ("type" IN ('transfer', 'reversal'))`,
)
@Check(
  'CHK_finance_transactions_reversal',
  `("type" = 'reversal' AND "reversalOfId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversalOfId" IS NULL)`,
)
@Check(
  'CHK_finance_transactions_hidden',
  `("supersededById" IS NULL OR "deletedAt" IS NULL) AND ("type" <> 'reversal' OR ("supersededById" IS NULL AND "deletedAt" IS NULL))`,
)
@Index(
  'UQ_finance_transactions_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('UQ_finance_transactions_reversal', ['reversalOfId'], {
  unique: true,
  where: '"reversalOfId" IS NOT NULL',
})
@Index('UQ_finance_transactions_superseded_by', ['supersededById'], {
  unique: true,
  where: '"supersededById" IS NOT NULL',
})
@Index(
  'UQ_finance_transactions_household_external',
  ['householdId', 'sourceType', 'externalId'],
  { unique: true, where: '"externalId" IS NOT NULL' },
)
@Index('IDX_finance_transactions_household_occurred', [
  'householdId',
  'occurredOn',
  'createdAt',
])
export class FinanceTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_transactions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceTransactionType;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'CNY' })
  currency: 'CNY';

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  occurredOn: string;

  @ManyToOne(() => FinanceCategory, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'categoryId',
    foreignKeyConstraintName: 'FK_finance_transactions_category',
  })
  category: FinanceCategory | null;

  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_finance_transactions_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: FinanceTransactionSourceType;

  @Column({ type: 'varchar', length: 180 })
  sourceId: string;

  /** K1 导入的交易单号（支付宝 / 微信）；非空时按家庭 + 来源唯一。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  externalId: string | null;

  /** 交易对方（导入、截图识别时填）。 */
  @Column({ type: 'varchar', length: 120, nullable: true })
  merchant: string | null;

  /** K2 截图记账的截图文件名。 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentPath: string | null;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @ManyToOne(() => FinanceTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversalOfId',
    foreignKeyConstraintName: 'FK_finance_transactions_reversal_of',
  })
  reversalOf: FinanceTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  /** K5：改金额 / 账户 / 收支方向时冲销本笔、另记一笔，这里指向新的那笔 */
  @ManyToOne(() => FinanceTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'supersededById',
    foreignKeyConstraintName: 'FK_finance_transactions_superseded_by',
  })
  supersededBy: FinanceTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  supersededById: string | null;

  /** K5：删除 = 冲销 + 记下删除时间（列表默认不显示） */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => FinancePosting, (posting) => posting.transaction, {
    eager: true,
  })
  postings: FinancePosting[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('finance_postings')
@Check('CHK_finance_postings_delta', `"delta" <> 0`)
@Index('IDX_finance_postings_account_created', ['accountId', 'createdAt'])
@Index('IDX_finance_postings_household_transaction', [
  'householdId',
  'transactionId',
])
export class FinancePosting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_postings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FinanceTransaction, (transaction) => transaction.postings, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'transactionId',
    foreignKeyConstraintName: 'FK_finance_postings_transaction',
  })
  transaction: FinanceTransaction;

  @Column('uuid')
  transactionId: string;

  @ManyToOne(() => FinanceAccount, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_finance_postings_account',
  })
  account: FinanceAccount;

  @Column('uuid')
  accountId: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  delta: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}
