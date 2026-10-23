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
import { AgentMemberChannel } from './agent-channels';
import { AgentRuntimeKind, AgentMemberProfile } from './agent-settings';
import { Household, Member } from './household';

export type AgentConversationStatus = 'active' | 'archived' | 'expired';

export type AgentConversationSource = 'app' | 'channel';

export type AgentMessageRole = 'user' | 'assistant';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentToolEventStatus = 'running' | 'completed' | 'failed';

@Entity('agent_conversations')
@Check(
  'CHK_agent_conversations_status',
  `"status" IN ('active', 'archived', 'expired')`,
)
@Check('CHK_agent_conversations_source', `"source" IN ('app', 'channel')`)
@Index('IDX_agent_conversations_household_member', [
  'householdId',
  'createdByMemberId',
  'updatedAt',
])
@Index('UQ_agent_conversations_channel_thread', [
  'householdId',
  'channelId',
  'externalThreadRefHash',
], { unique: true })
export class AgentConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_conversations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_conversations_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @ManyToOne(() => AgentMemberProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'agentProfileId',
    foreignKeyConstraintName: 'FK_agent_conversations_profile',
  })
  agentProfile: AgentMemberProfile;

  @Column('uuid')
  agentProfileId: string;

  @Column({ type: 'varchar', length: 16, default: 'app' })
  source: AgentConversationSource;

  @ManyToOne(() => AgentMemberChannel, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_agent_conversations_channel',
  })
  channel: AgentMemberChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalThreadRefHash: string | null;

  @Column({ type: 'varchar', length: 120, default: '新对话' })
  title: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AgentConversationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_messages')
@Check('CHK_agent_messages_role', `"role" IN ('user', 'assistant')`)
@Check('CHK_agent_messages_content_version', `"contentVersion" >= 1`)
@Index('IDX_agent_messages_conversation_created', ['conversationId', 'createdAt'])
@Index('IDX_agent_messages_run_created', ['runId', 'createdAt'])
export class AgentMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_messages_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_messages_conversation',
  })
  conversation: AgentConversation;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_messages_member',
  })
  member: Member | null;

  @Column({ type: 'uuid', nullable: true })
  memberId: string | null;

  @ManyToOne(() => AgentRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_messages_run',
  })
  run: AgentRun | null;

  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  @Column({ type: 'varchar', length: 16 })
  role: AgentMessageRole;

  @Column({ type: 'text' })
  contentCiphertext: string;

  @Column({ type: 'varchar', length: 32 })
  contentNonce: string;

  @Column({ type: 'int', default: 1 })
  contentVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('agent_runs')
@Unique('UQ_agent_runs_household_idempotency', [
  'householdId',
  'clientRequestId',
])
@Check(
  'CHK_agent_runs_status',
  `"status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')`,
)
@Check('CHK_agent_runs_runtime_kind', `"runtimeKind" IN ('fake', 'hermes', 'native')`)
@Check('CHK_agent_runs_tier', `"tier" IS NULL OR "tier" BETWEEN 0 AND 2`)
@Check(
  'CHK_agent_runs_tokens',
  `("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0)`,
)
@Index('IDX_agent_runs_conversation_created', ['conversationId', 'createdAt'])
@Index('IDX_agent_runs_authorization_expiry', ['authorizationExpiresAt'])
@Index('UQ_agent_runs_retry_of', ['retryOfRunId'], {
  unique: true,
  where: `"retryOfRunId" IS NOT NULL`,
})
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_runs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_runs_conversation',
  })
  conversation: AgentConversation;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedByMemberId',
    foreignKeyConstraintName: 'FK_agent_runs_requested_by',
  })
  requestedByMember: Member;

  @Column('uuid')
  requestedByMemberId: string;

  @ManyToOne(() => AgentMemberProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'agentProfileId',
    foreignKeyConstraintName: 'FK_agent_runs_profile',
  })
  agentProfile: AgentMemberProfile;

  @Column('uuid')
  agentProfileId: string;

  @Column({ type: 'varchar', length: 180 })
  clientRequestId: string;

  @ManyToOne(() => AgentRun, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'retryOfRunId',
    foreignKeyConstraintName: 'FK_agent_runs_retry_of',
  })
  retryOfRun: AgentRun | null;

  @Column({ type: 'uuid', nullable: true })
  retryOfRunId: string | null;

  @Column({ type: 'varchar', length: 16 })
  runtimeKind: AgentRuntimeKind;

  @Column({ type: 'varchar', length: 64 })
  runtimeVersion: string;

  @Column({ type: 'varchar', length: 120 })
  modelAlias: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: AgentRunStatus;

  @Column({ type: 'jsonb', default: [] })
  allowedTools: string[];

  @Column({ type: 'timestamptz' })
  authorizationExpiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  inputTokens: number | null;

  @Column({ type: 'int', nullable: true })
  outputTokens: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true })
  estimatedCost: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  errorMessage: string | null;

  /** 助理档位（J4.3）：云端运行方式（hermes / native）的 run 记 2，本地确定性助理留空；每日上限按它数。 */
  @Column({ type: 'smallint', nullable: true })
  tier: number | null;

  /** 这次发给模型前是否做了脱敏（tier2Redact，native 才做）。 */
  @Column({ type: 'boolean', default: false })
  redacted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_tool_events')
@Check(
  'CHK_agent_tool_events_status',
  `"status" IN ('running', 'completed', 'failed')`,
)
@Check(
  'CHK_agent_tool_events_presentation',
  `("presentationCiphertext" IS NULL AND "presentationNonce" IS NULL AND "presentationVersion" IS NULL) OR ("presentationCiphertext" IS NOT NULL AND "presentationNonce" IS NOT NULL AND "presentationVersion" >= 1)`,
)
@Index('IDX_agent_tool_events_run_started', ['runId', 'startedAt'])
export class AgentToolEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_tool_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_tool_events_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @Column({ type: 'varchar', length: 80 })
  toolName: string;

  @Column({ type: 'varchar', length: 40 })
  sourceModule: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: AgentToolEventStatus;

  @Column({ type: 'jsonb', default: {} })
  inputSummary: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  outputSummary: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  presentationCiphertext: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  presentationNonce: string | null;

  @Column({ type: 'int', nullable: true })
  presentationVersion: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
