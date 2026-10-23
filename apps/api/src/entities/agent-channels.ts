import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';

export type AgentChannelPlatform = string;

@Entity('agent_member_channels')
@Check(
  'CHK_agent_member_channels_platform',
  `"platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'`,
)
@Check('CHK_agent_member_channels_version', `"version" >= 1`)
@Index('UQ_agent_member_channels_active_external', [
  'householdId',
  'platform',
  'externalAccountRefHash',
], { unique: true, where: '"revokedAt" IS NULL' })
@Index('IDX_agent_member_channels_household_member', [
  'householdId',
  'memberId',
  'revokedAt',
])
export class AgentMemberChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_member_channels_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_member_channels_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: AgentChannelPlatform;

  @Column({ type: 'varchar', length: 64 })
  externalAccountRefHash: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  externalAccountLabel: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  externalAccountHint: string | null;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  pairedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_channel_pairings')
@Check(
  'CHK_agent_channel_pairings_platform',
  `"platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'`,
)
@Check('CHK_agent_channel_pairings_version', `"version" >= 1`)
@Index('UQ_agent_channel_pairings_code', ['codeHash'], { unique: true })
@Index('UQ_agent_channel_pairings_household_idempotency', [
  'householdId',
  'idempotencyKey',
], { unique: true })
@Index('IDX_agent_channel_pairings_household_status', [
  'householdId',
  'memberId',
  'revokedAt',
  'usedAt',
  'expiresAt',
])
export class AgentChannelPairing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: AgentChannelPlatform;

  @Column({ type: 'varchar', length: 64, select: false })
  codeHash: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => AgentMemberChannel, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_channel',
  })
  channel: AgentMemberChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
