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
} from 'typeorm';
import { Household, Member } from './household';

export type AssistantUtteranceSource = 'command_palette' | 'today_search' | 'agent_chat';

export type AssistantUtteranceOutcome = 'navigated' | 'proposed' | 'candidates' | 'no_match' | 'dismissed';

export type AssistantUtteranceChosenKind = 'action' | 'page' | 'dish' | 'item' | 'agent';

/**
 * J2 助理原话（architecture §2.3）：⌘K / 今天页搜索条 / 小管家对话每「一次输入结束」记一条，
 * 第 0 档模板迭代与评测集的唯一数据源。只存本地库；tier / intentId / confidence / correctedIntentId 由 J3 起的引擎填。
 */
@Entity('assistant_utterances')
@Check('CHK_assistant_utterances_text', `char_length("text") BETWEEN 1 AND 200`)
@Check('CHK_assistant_utterances_source', `"source" IN ('command_palette', 'today_search', 'agent_chat')`)
@Check('CHK_assistant_utterances_outcome', `"outcome" IN ('navigated', 'proposed', 'candidates', 'no_match', 'dismissed')`)
@Check('CHK_assistant_utterances_chosen_kind', `"chosenKind" IS NULL OR "chosenKind" IN ('action', 'page', 'dish', 'item', 'agent')`)
@Check('CHK_assistant_utterances_tier', `"tier" IS NULL OR "tier" BETWEEN 0 AND 2`)
@Check('CHK_assistant_utterances_confidence', `"confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)`)
@Index('IDX_assistant_utterances_household_created', ['householdId', 'createdAt'])
@Unique('UQ_assistant_utterances_client', ['householdId', 'memberId', 'clientId'])
export class AssistantUtteranceRecord {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_assistant_utterances' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_assistant_utterances_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId', foreignKeyConstraintName: 'FK_assistant_utterances_member' })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column('uuid')
  clientId: string;

  @Column({ type: 'varchar', length: 200 })
  text: string;

  @Column({ type: 'varchar', length: 24 })
  source: AssistantUtteranceSource;

  @Column({ type: 'smallint', nullable: true })
  tier: number | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  intentId: string | null;

  /** numeric 在 pg 驱动里是字符串，展示时转数字 */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence: string | null;

  @Column({ type: 'varchar', length: 16 })
  outcome: AssistantUtteranceOutcome;

  @Column({ type: 'varchar', length: 16, nullable: true })
  chosenKind: AssistantUtteranceChosenKind | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  chosenId: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  correctedIntentId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
