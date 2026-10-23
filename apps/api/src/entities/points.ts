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

export type PointsLedgerType =
  | 'award'
  | 'adjustment'
  | 'redemption'
  | 'reversal';

export type PointsLedgerSourceType =
  | 'manual'
  | 'task'
  | 'reward_redemption'
  | 'points_ledger';

export type RewardRedemptionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'reversed';

@Entity('points_accounts')
@Check('CHK_points_accounts_balance', `"balance" >= 0`)
@Unique('UQ_points_accounts_household_member', ['householdId', 'memberId'])
@Index('IDX_points_accounts_household_balance', ['householdId', 'balance'])
export class PointsAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_points_accounts_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_points_accounts_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'int', default: 0 })
  balance: number;

  @OneToMany(() => PointsLedger, (entry) => entry.account)
  ledger: PointsLedger[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('points_ledger')
@Check(
  'CHK_points_ledger_type',
  `"type" IN ('award', 'adjustment', 'redemption', 'reversal')`,
)
@Check(
  'CHK_points_ledger_source_type',
  `"sourceType" IN ('manual', 'task', 'reward_redemption', 'points_ledger')`,
)
@Check(
  'CHK_points_ledger_quantities',
  `"pointsBefore" >= 0 AND "pointsAfter" >= 0 AND "delta" <> 0 AND "pointsAfter" = "pointsBefore" + "delta"`,
)
@Check(
  'CHK_points_ledger_reversal',
  `("type" = 'reversal' AND "reversesLedgerId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesLedgerId" IS NULL)`,
)
@Index(
  'UQ_points_ledger_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_points_ledger_household_created', ['householdId', 'createdAt'])
@Index('IDX_points_ledger_member_created', ['memberId', 'createdAt'])
@Index('UQ_points_ledger_reversal', ['reversesLedgerId'], {
  unique: true,
  where: '"reversesLedgerId" IS NOT NULL',
})
export class PointsLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_points_ledger_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => PointsAccount, (account) => account.ledger, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_points_ledger_account',
  })
  account: PointsAccount;

  @Column('uuid')
  accountId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_points_ledger_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 24 })
  type: PointsLedgerType;

  @Column({ type: 'int' })
  pointsBefore: number;

  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'int' })
  pointsAfter: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_points_ledger_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: PointsLedgerSourceType;

  @Column({ type: 'varchar', length: 180 })
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversesLedgerId',
    foreignKeyConstraintName: 'FK_points_ledger_reverses',
  })
  reversesLedger: PointsLedger | null;

  @Column({ type: 'uuid', nullable: true })
  reversesLedgerId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('rewards')
@Check('CHK_rewards_cost', `"cost" >= 1 AND "cost" <= 1000000`)
@Unique('UQ_rewards_household_name', ['householdId', 'name'])
@Index('IDX_rewards_household_active', ['householdId', 'isActive', 'createdAt'])
export class Reward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_rewards_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  cost: number;

  @Column({ default: true })
  isActive: boolean;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_rewards_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('reward_redemptions')
@Check('CHK_reward_redemptions_cost', `"cost" >= 1`)
@Check(
  'CHK_reward_redemptions_status',
  `"status" IN ('pending', 'approved', 'rejected', 'cancelled', 'reversed')`,
)
@Index('UQ_reward_redemptions_household_request_key', ['householdId', 'requestIdempotencyKey'], { unique: true })
@Index('UQ_reward_redemptions_household_resolution_key', ['householdId', 'resolutionIdempotencyKey'], { unique: true, where: '"resolutionIdempotencyKey" IS NOT NULL' })
@Index('UQ_reward_redemptions_household_reversal_key', ['householdId', 'reversalIdempotencyKey'], { unique: true, where: '"reversalIdempotencyKey" IS NOT NULL' })
@Index('UQ_reward_redemptions_debit_ledger', ['debitLedgerId'], { unique: true })
@Index('UQ_reward_redemptions_restore_ledger', ['restoreLedgerId'], { unique: true, where: '"restoreLedgerId" IS NOT NULL' })
@Index('IDX_reward_redemptions_household_status', ['householdId', 'status', 'createdAt'])
@Index('IDX_reward_redemptions_member_created', ['memberId', 'createdAt'])
export class RewardRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_reward_redemptions_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Reward, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'rewardId', foreignKeyConstraintName: 'FK_reward_redemptions_reward' })
  reward: Reward;

  @Column('uuid')
  rewardId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'memberId', foreignKeyConstraintName: 'FK_reward_redemptions_member' })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 120 })
  rewardName: string;

  @Column({ type: 'int' })
  cost: number;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: RewardRedemptionStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  requestNote: string | null;

  @Column({ type: 'varchar', length: 180 })
  requestIdempotencyKey: string;

  @ManyToOne(() => PointsLedger, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'debitLedgerId', foreignKeyConstraintName: 'FK_reward_redemptions_debit' })
  debitLedger: PointsLedger;

  @Column('uuid')
  debitLedgerId: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'handledById', foreignKeyConstraintName: 'FK_reward_redemptions_handled_by' })
  handledBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  handledById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  handledAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  resolutionIdempotencyKey: string | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'restoreLedgerId', foreignKeyConstraintName: 'FK_reward_redemptions_restore' })
  restoreLedger: PointsLedger | null;

  @Column({ type: 'uuid', nullable: true })
  restoreLedgerId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversedById', foreignKeyConstraintName: 'FK_reward_redemptions_reversed_by' })
  reversedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  reversedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reversalNote: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  reversalIdempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
