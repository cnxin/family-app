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
import { AgentConversation, AgentRun } from './agent-runs';
import { Household, Member } from './household';

export type AgentActionType =
  | 'task'
  | 'reminder'
  | 'poll'
  | 'menu'
  | 'shopping'
  | 'finance';

export type AgentActionProposalStatus =
  | 'pending'
  | 'confirmed'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'failed';

export type AgentProposalGroupStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';

export type AgentProposalGroupEventOperation =
  | 'created'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';

@Entity('agent_proposal_groups')
@Check(
  'CHK_agent_proposal_groups_status',
  `"status" IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')`,
)
@Check('CHK_agent_proposal_groups_version', `"version" >= 1`)
@Index('IDX_agent_proposal_groups_household_status_created', [
  'householdId',
  'status',
  'createdAt',
])
export class AgentProposalGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_conversation',
  })
  conversation: AgentConversation | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne(() => AgentRun, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedByMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_requested_by',
  })
  requestedByMember: Member;

  @Column('uuid')
  requestedByMemberId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 400 })
  summary: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AgentProposalGroupStatus;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_proposal_group_events')
@Check(
  'CHK_agent_proposal_group_events_operation',
  `"operation" IN ('created', 'confirmed', 'rejected', 'expired', 'failed')`,
)
@Index('IDX_agent_proposal_group_events_group_created', ['groupId', 'createdAt'])
export class AgentProposalGroupEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentProposalGroup, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'groupId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_group',
  })
  group: AgentProposalGroup;

  @Column('uuid')
  groupId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_actor',
  })
  actorMember: Member;

  @Column('uuid')
  actorMemberId: string;

  @Column({ type: 'varchar', length: 16 })
  operation: AgentProposalGroupEventOperation;

  @Column({ type: 'int' })
  stepCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('agent_action_proposals')
@Unique('UQ_agent_action_proposals_creation', ['householdId', 'idempotencyKey'])
@Unique('UQ_agent_action_proposals_confirmation', [
  'householdId',
  'confirmationKey',
])
@Check(
  'CHK_agent_action_proposals_type',
  `"actionType" IN ('task', 'reminder', 'poll', 'menu', 'shopping')`,
)
@Check(
  'CHK_agent_action_proposals_status',
  `"status" IN ('pending', 'confirmed', 'executed', 'rejected', 'expired', 'failed')`,
)
@Check('CHK_agent_action_proposals_version', `"version" >= 1`)
@Index('IDX_agent_action_proposals_member_status', [
  'householdId',
  'createdByMemberId',
  'status',
  'createdAt',
])
@Index('IDX_agent_action_proposals_run_created', ['runId', 'createdAt'])
export class AgentActionProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentRun, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @ManyToOne(() => AgentProposalGroup, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'groupId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_group',
  })
  group: AgentProposalGroup | null;

  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'int', nullable: true })
  stepOrder: number | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'varchar', length: 24 })
  actionType: AgentActionType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  preview: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  confirmationKey: string | null;

  @Column({ type: 'int', nullable: true })
  expectedSourceVersion: number | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AgentActionProposalStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  resultModule: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  resultId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  failureMessage: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
