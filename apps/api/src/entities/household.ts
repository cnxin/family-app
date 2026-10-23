import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type MemberRole = 'owner' | 'admin' | 'member';

export type ActivityModule =
  | 'member'
  | 'invitation'
  | 'menu'
  | 'calendar'
  | 'task'
  | 'poll'
  | 'reminder'
  | 'shopping'
  | 'inventory'
  | 'recipe'
  | 'media'
  | 'guest'
  | 'asset'
  | 'points'
  | 'knowledge'
  | 'memory'
  | 'travel'
  | 'finance'
  | 'system';

@Entity('accounts')
@Index('UQ_accounts_login_name_normalized', ['loginNameNormalized'], {
  unique: true,
})
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  loginName: string;

  @Column({ type: 'varchar', length: 64, select: false })
  loginNameNormalized: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('households')
export class Household {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ default: 'Asia/Shanghai' })
  timezone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('members')
@Check('CHK_members_role', `"role" IN ('owner', 'admin', 'member')`)
@Index('IDX_members_household', ['householdId'])
@Index('IDX_members_account', ['accountId'])
@Index('IDX_members_household_status', ['householdId', 'disabledAt'])
@Unique('UQ_members_household_account', ['householdId', 'accountId'])
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_members_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_members_account',
  })
  account: Account | null;

  @Column({ type: 'uuid', nullable: true, select: false })
  accountId: string | null;

  @Column()
  name: string;

  @Column({ default: '🙂' })
  avatarEmoji: string;

  @Column({ type: 'varchar', default: 'member' })
  role: MemberRole;

  @Column({ default: false })
  prefersCooking: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('household_activity_logs')
@Check(
  'CHK_household_activity_logs_module',
  `"module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'travel', 'system')`,
)
@Index('IDX_household_activity_logs_household_created', [
  'householdId',
  'createdAt',
])
@Index('IDX_household_activity_logs_subject', ['subjectMemberId', 'createdAt'])
export class HouseholdActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_activity_logs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_household_activity_logs_actor',
  })
  actor: Member | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 64 })
  actorName: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'subjectMemberId',
    foreignKeyConstraintName: 'FK_household_activity_logs_subject',
  })
  subjectMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  subjectMemberId: string | null;

  @Column({ type: 'varchar', length: 32 })
  module: ActivityModule;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 180 })
  summary: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  targetPath: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('auth_sessions')
@Check(
  'CHK_auth_sessions_role_snapshot',
  `"roleSnapshot" IN ('owner', 'admin', 'member')`,
)
@Index('UQ_auth_sessions_refresh_token_hash', ['refreshTokenHash'], {
  unique: true,
})
@Index('IDX_auth_sessions_member_status', ['memberId', 'revokedAt'])
@Index('IDX_auth_sessions_account_status', ['accountId', 'revokedAt'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_auth_sessions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_auth_sessions_account',
  })
  account: Account;

  @Column('uuid')
  accountId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_auth_sessions_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 64 })
  refreshTokenHash: string;

  @Column({ type: 'varchar' })
  roleSnapshot: MemberRole;

  @Column({ type: 'varchar', length: 64 })
  credentialSnapshot: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_invitations')
@Check(
  'CHK_household_invitations_role',
  `"role" IN ('admin', 'member')`,
)
@Index('UQ_household_invitations_token_hash', ['tokenHash'], {
  unique: true,
})
@Index('IDX_household_invitations_household_status', [
  'householdId',
  'acceptedAt',
  'revokedAt',
])
export class HouseholdInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_invitations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({ type: 'varchar', length: 64 })
  memberName: string;

  @Column({ type: 'varchar', length: 16, default: '🙂' })
  avatarEmoji: string;

  @Column({ type: 'varchar', default: 'member' })
  role: Exclude<MemberRole, 'owner'>;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'invitedById',
    foreignKeyConstraintName: 'FK_household_invitations_invited_by',
  })
  invitedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  invitedById: string | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'acceptedByAccountId',
    foreignKeyConstraintName: 'FK_household_invitations_accepted_by_account',
  })
  acceptedByAccount: Account | null;

  @Column({ type: 'uuid', nullable: true })
  acceptedByAccountId: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('household_module_overrides')
@Check('CHK_household_module_overrides_value', "override IN ('on', 'off')")
export class HouseholdModuleOverride {
  @PrimaryColumn('uuid', { name: 'household_id', primaryKeyConstraintName: 'PK_household_module_overrides' })
  householdId: string;

  @PrimaryColumn({ type: 'varchar', length: 32, primaryKeyConstraintName: 'PK_household_module_overrides' })
  key: string;

  @Column({ type: 'varchar', length: 3 })
  override: 'on' | 'off';

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column('uuid', { name: 'updated_by' })
  updatedBy: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'household_id', foreignKeyConstraintName: 'FK_household_module_overrides_household' })
  household: Household;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'updated_by', foreignKeyConstraintName: 'FK_household_module_overrides_updated_by' })
  member: Member;
}
