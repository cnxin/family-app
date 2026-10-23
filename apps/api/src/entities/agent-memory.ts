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
import { AgentConversation } from './agent-runs';
import { Household, Member } from './household';

export type AgentMemoryScope = 'member_private' | 'household';

export type AgentMemoryKind =
  | 'preference'
  | 'fact'
  | 'episodic_summary'
  | 'routine_context';

export type AgentMemoryStatus =
  | 'candidate'
  | 'active'
  | 'revoked'
  | 'forgotten'
  | 'expired';

export type AgentMemoryConfidenceSource =
  | 'explicit'
  | 'business'
  | 'summary_candidate';

export type AgentMemoryEventOperation =
  | 'created'
  | 'confirmed'
  | 'corrected'
  | 'shared'
  | 'revoked'
  | 'forgotten'
  | 'expired';

@Entity('agent_memory_items')
@Check(
  'CHK_agent_memory_items_scope',
  `"scope" IN ('member_private', 'household')`,
)
@Check(
  'CHK_agent_memory_items_kind',
  `"kind" IN ('preference', 'fact', 'episodic_summary', 'routine_context')`,
)
@Check(
  'CHK_agent_memory_items_status',
  `"status" IN ('candidate', 'active', 'revoked', 'forgotten', 'expired')`,
)
@Check(
  'CHK_agent_memory_items_confidence_source',
  `"confidenceSource" IN ('explicit', 'business', 'summary_candidate')`,
)
@Check(
  'CHK_agent_memory_items_content',
  `("status" IN ('forgotten', 'expired') AND "contentCiphertext" IS NULL AND "contentNonce" IS NULL AND "contentVersion" IS NULL) OR ("status" NOT IN ('forgotten', 'expired') AND "contentCiphertext" IS NOT NULL AND "contentNonce" IS NOT NULL AND "contentVersion" IS NOT NULL AND "contentVersion" >= 1)`,
)
@Check('CHK_agent_memory_items_version', `"version" >= 1`)
@Index(
  'UQ_agent_memory_items_active_key',
  ['householdId', 'ownerMemberId', 'scope', 'memoryKey'],
  { unique: true, where: `"status" = 'active'` },
)
@Index('IDX_agent_memory_items_household_owner_status', [
  'householdId',
  'ownerMemberId',
  'scope',
  'status',
  'updatedAt',
])
export class AgentMemoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_memory_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ownerMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_items_owner',
  })
  ownerMember: Member;

  @Column('uuid')
  ownerMemberId: string;

  @Column({ type: 'varchar', length: 16, default: 'member_private' })
  scope: AgentMemoryScope;

  @Column({ type: 'varchar', length: 24, default: 'preference' })
  kind: AgentMemoryKind;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'varchar', length: 32 })
  memoryKey: string;

  @Column({ type: 'text', nullable: true })
  contentCiphertext: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contentNonce: string | null;

  @Column({ type: 'int', nullable: true })
  contentVersion: number | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @ManyToOne(() => AgentConversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceConversationId',
    foreignKeyConstraintName: 'FK_agent_memory_items_source_conversation',
  })
  sourceConversation: AgentConversation | null;

  @Column({ type: 'uuid', nullable: true })
  sourceConversationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceMessageId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'candidate' })
  status: AgentMemoryStatus;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_items_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'varchar', length: 24, default: 'summary_candidate' })
  confidenceSource: AgentMemoryConfidenceSource;

  @Column({ type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_memory_events')
@Check(
  'CHK_agent_memory_events_operation',
  `"operation" IN ('created', 'confirmed', 'corrected', 'shared', 'revoked', 'forgotten', 'expired')`,
)
@Index('IDX_agent_memory_events_item_created', ['memoryItemId', 'createdAt'])
export class AgentMemoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_memory_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentMemoryItem, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memoryItemId',
    foreignKeyConstraintName: 'FK_agent_memory_events_item',
  })
  memoryItem: AgentMemoryItem;

  @Column('uuid')
  memoryItemId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_events_actor',
  })
  actorMember: Member;

  @Column('uuid')
  actorMemberId: string;

  @Column({ type: 'varchar', length: 16 })
  operation: AgentMemoryEventOperation;

  @Column({ type: 'varchar', length: 16, nullable: true })
  fromScope: AgentMemoryScope | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  toScope: AgentMemoryScope | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
